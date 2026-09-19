"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ArrowRight, ArrowUpRight, CaretRight, Check, MagnifyingGlass, X } from "@/components/ui/icons";
import { useRouter, useSearchParams } from "next/navigation";
import type { Route } from "next";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { Keypair, PublicKey } from "@solana/web3.js";
import { useQuery } from "@tanstack/react-query";
import bs58 from "bs58";
import { motion } from "motion/react";
import type { TokenJson } from "@/lib/api-types";
import type { QuotePair } from "@/lib/launchlab/pairs";
import type { LaunchPricing } from "@/lib/launchlab/pricing";
import { buyIxs, createLaunchIx, tradeParamsFromPricing } from "@/lib/launchlab/tx";
import { clusterLabel, activeCluster, explorerAddressUrl, isCustodial } from "@/lib/solana/cluster";
import { CREATOR_FEE_PCT, EPOCH_OPTIONS, MAX_BASKET, evenWeights, fmtDuration, reviewWindowFor, withAdded, withRemoved } from "@/lib/launch/options";
import { prepareVaultIxs } from "@/lib/launch/prepare";
import { useLaunchCost, useVault, useVaultConfig, registerLaunch } from "@/lib/hooks/useApi";
import { useSolanaTx } from "@/lib/hooks/useSolanaTx";
import { useProgram } from "@/lib/hooks/useProgram";
import { bindLaunchIx, createVaultIxs } from "@/lib/solana/ix";
import { formatSol, formatUsd, parseAmount, shortAddress, timeAgo } from "@/lib/format";
import { Button, Callout, Field, Input, Textarea, cx } from "@/components/ui/primitives";
import { TokenIcon } from "@/components/token-icon";
import { segmentColor } from "@/components/vaults/vaults-list";
import { CoinPreview, LaunchSculpture } from "./launch-studio";
import { LogoPicker } from "./logo-picker";
import { QuotePicker } from "./quote-picker";
import { RewardRibbon } from "./reward-ribbon";

interface BasketItem {
  token: TokenJson;
  weight: number;
}

const SOCIALS = ["twitter", "telegram", "website"] as const;
const SOCIAL_PLACEHOLDER: Record<(typeof SOCIALS)[number], string> = { twitter: "https://x.com/…", telegram: "https://t.me/…", website: "https://…" };

const WSOL = "So11111111111111111111111111111111111111112";

/** A launch drafted in the Telegram bot (GET /api/launch/drafts/:id), opened here to sign with the user's own wallet. */
interface TelegramDraft {
  id: string;
  name: string;
  symbol: string;
  logo: string;
  description: string;
  socials: { twitter?: string; telegram?: string; website?: string };
  quoteMint: string | null;
  initialBuy: string | null;
  basket: { mint: string; weight: number }[];
  epochLength: number | null;
}

/* ---------------------------------------------------------------- mint keypair persistence */

const mintKey = (vault: string) => `causa:mint:${vault}`;

/** The coin's mint keypair is generated before the vault exists (the vault commits to it) and kept in this
 *  browser until the coin is created; losing it means the vault can only ever be bound to a coin that cannot be made. */
function storeMint(vault: string, kp: Keypair) {
  try {
    sessionStorage.setItem(mintKey(vault), bs58.encode(kp.secretKey));
    localStorage.setItem(mintKey(vault), bs58.encode(kp.secretKey));
  } catch {
    // private mode: the wizard still works within this page load
  }
}
function loadMint(vault: string): Keypair | null {
  try {
    const raw = sessionStorage.getItem(mintKey(vault)) ?? localStorage.getItem(mintKey(vault));
    return raw ? Keypair.fromSecretKey(bs58.decode(raw)) : null;
  } catch {
    return null;
  }
}

/* ---------------------------------------------------------------- wizard */

/**
 * Launch flow: (1) coin details, (2) the stock basket holders are paid in, (3) review, then two transactions:
 * `create_vault` (committing to the coin's mint) and LaunchLab's create with the vault as `creator`, so StonkFun
 * forwards the coin's creator fees to the vault. Creator fees then land on the vault and the keeper turns them
 * into stock dividends for holders. `?vault=…&mint=…` resumes the launch step for a vault that was created
 * but never got its coin.
 */
export function LaunchWizard() {
  const router = useRouter();
  const search = useSearchParams();
  const { publicKey } = useWallet();
  const { setVisible } = useWalletModal();
  const { connection } = useConnection();
  const program = useProgram();
  const user = publicKey?.toBase58() ?? null;
  const tx = useSolanaTx();
  const { data: vcfg, error: vcfgError, refetch: retryConfig, isFetching: configFetching } = useVaultConfig();
  const resumeVault = search.get("vault");
  const { data: resumed } = useVault(resumeVault ?? null);
  // `?draft=`: a launch drafted in the Telegram bot, opened here to sign with this wallet. It stays in the URL
  // through the resume redirect so the bot still hears about the launch after a reload.
  const draftId = search.get("draft");
  const { data: draft, error: draftError } = useQuery({
    queryKey: ["launch", "draft", draftId],
    queryFn: async () => {
      const res = await fetch(`/api/launch/drafts/${draftId}`);
      const body = (await res.json()) as { draft?: TelegramDraft; error?: string };
      if (!res.ok || !body.draft) throw new Error(body.error ?? "could not load the Telegram draft");
      return body.draft;
    },
    enabled: !!draftId,
    retry: false,
    staleTime: Infinity,
  });

  const [step, setStep] = useState(0);
  const stepHeading = useRef<HTMLHeadingElement>(null);
  const previousStep = useRef(step);
  useEffect(() => {
    if (previousStep.current === step) return;
    previousStep.current = step;
    stepHeading.current?.focus({ preventScroll: true });
    stepHeading.current?.scrollIntoView({ block: "start", behavior: "instant" });
  }, [step]);
  const [name, setName] = useState("");
  const [symbol, setSymbol] = useState("");
  const [logo, setLogo] = useState("");
  const [description, setDescription] = useState("");
  const [socials, setSocials] = useState({ twitter: "", telegram: "", website: "" });
  const [showSocials, setShowSocials] = useState(false);
  const socialCount = SOCIALS.filter((k) => socials[k].trim() !== "").length;
  const [initialBuy, setInitialBuy] = useState("");
  const [draftReady, setDraftReady] = useState(false);
  const [saveState, setSaveState] = useState<"saved" | "unavailable" | null>(null);
  useEffect(() => {
    if (draftId || resumeVault) return;
    try {
      const raw = localStorage.getItem("linkr:coin-details:v1");
      const saved = raw ? JSON.parse(raw) : null;
      if (saved?.version === 1) {
        if (typeof saved.name === "string") setName(saved.name.slice(0, 32));
        if (typeof saved.symbol === "string") setSymbol(saved.symbol.slice(0, 10));
        if (typeof saved.logo === "string") setLogo(saved.logo.slice(0, 4096));
        if (typeof saved.description === "string") setDescription(saved.description.slice(0, 280));
        if (saved.socials && SOCIALS.every(key => typeof saved.socials[key] === "string")) setSocials(saved.socials);
      }
    } catch { setSaveState("unavailable"); }
    setDraftReady(true);
  }, [draftId, resumeVault]);
  useEffect(() => {
    if (!draftReady || draftId || resumeVault) return;
    try {
      // Save identity only. Restoring an amount without its verified quote could change economic intent.
      localStorage.setItem("linkr:coin-details:v1", JSON.stringify({ version: 1, name, symbol, logo, description, socials }));
      setSaveState("saved");
    } catch { setSaveState("unavailable"); }
  }, [draftReady, draftId, resumeVault, name, symbol, logo, description, socials]);
  // the quote token: what the coin trades against, and so what creator fees arrive in
  const [pickedQuote, setQuote] = useState<QuotePair | null>(null);
  const { data: pairs, error: pairsError, refetch: retryPairs, isFetching: pairsFetching } = useQuery({
    queryKey: ["launch", "pairs"],
    queryFn: async () => {
      const response = await fetch("/api/launch/pairs");
      const body = await response.json() as { pairs?: QuotePair[]; error?: string };
      if (!response.ok || !Array.isArray(body.pairs)) throw new Error(body.error ?? "Quote tokens are unavailable");
      return body.pairs;
    },
    staleTime: 60_000,
  });
  // SOL until the creator picks something else
  const quote = pickedQuote ?? (pairs?.length ? (pairs.find((p) => p.symbol === "SOL") ?? pairs[0]) : null);
  const quoteMint = resumed?.quote?.mint ?? quote?.mint ?? null;
  const quoteSymbol = resumed?.quote?.symbol ?? quote?.symbol ?? "SOL";
  const quoteDecimals = resumed?.quote?.decimals ?? quote?.decimals ?? 9;
  const quoteIsSol = quoteMint === WSOL;
  const initialBuyRaw = parseAmount(initialBuy || "0", quoteDecimals) ?? 0n;
  /** what the initial buy adds to the SOL the wallet needs (a token-quoted buy spends that token instead) */
  const initialBuyLamports = quoteIsSol ? initialBuyRaw : 0n;
  // basket
  const [basket, setBasket] = useState<BasketItem[]>([]);
  const [basketSearch, setBasketSearch] = useState("");
  const [epochLength, setEpochLength] = useState(7 * 86_400);
  const [prefillApplied, setPrefillApplied] = useState(false);
  const prefill = search.get("basket");
  if (vcfg && prefill && !prefillApplied && !draftId && !resumeVault) {
    setPrefillApplied(true);
    try {
      const values = JSON.parse(prefill) as {mint:string;weight:number}[];
      if (Array.isArray(values) && values.length > 0 && values.length <= 10 && new Set(values.map(v=>v.mint)).size === values.length && values.every(v=>Number.isInteger(v.weight)&&v.weight>=1&&vcfg.basketTokens.some(t=>t.mint===v.mint)) && values.reduce((s,v)=>s+v.weight,0)===100) {
        setBasket(values.map(v=>({token:vcfg.basketTokens.find(t=>t.mint===v.mint)!,weight:v.weight})));
      }
    } catch { /* invalid URL data never changes the supported basket */ }
  }
  const [focus, setFocus] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const dragged = useRef(false);
  // created vault (tx 1 done, tx 2 pending / failed) and the mint it committed to
  const [vault, setVault] = useState<string | null>(null);
  const [mint, setMint] = useState<Keypair | null>(null);
  useEffect(() => {
    if (resumeVault && !mint) setMint(loadMint(resumeVault));
  }, [resumeVault, mint]);
  // fill the wizard from the Telegram draft once, then go straight to the review (state adjusted during render,
  // React's pattern for state that follows loaded data, rather than an effect)
  const [appliedDraft, setAppliedDraft] = useState<string | null>(null);
  if (draft && vcfg && pairs && appliedDraft !== draft.id) {
    setAppliedDraft(draft.id);
    setName(draft.name);
    setSymbol(draft.symbol);
    setLogo(draft.logo);
    setDescription(draft.description);
    setSocials({ twitter: draft.socials.twitter ?? "", telegram: draft.socials.telegram ?? "", website: draft.socials.website ?? "" });
    if (Object.values(draft.socials).some(Boolean)) setShowSocials(true);
    const q = draft.quoteMint ? pairs.find((p) => p.mint === draft.quoteMint) : null;
    if (q) setQuote(q);
    setInitialBuy(draft.initialBuy ?? "");
    setBasket(
      draft.basket.flatMap((b) => {
        const token = vcfg.basketTokens.find((t) => t.mint === b.mint);
        return token ? [{ token, weight: b.weight }] : [];
      }),
    );
    if (draft.epochLength) setEpochLength(draft.epochLength);
    setStep(resumeVault ? 1 : 2);
  }

  const { data: cost } = useLaunchCost(Math.max(basket.length, 1));
  const { data: held } = useQuery({
    queryKey: ["balance", user],
    queryFn: async () => BigInt(await connection.getBalance(publicKey!)),
    enabled: !!publicKey,
    refetchInterval: 15_000,
  });

  const totalWeight = basket.reduce((s, a) => s + a.weight, 0);
  const basketOk = basket.length >= 1 && basket.length <= MAX_BASKET && totalWeight === 100 && basket.every((a) => a.weight >= 1);
  const pickable = useMemo(() => {
    const q = basketSearch.trim().toLowerCase();
    return (vcfg?.basketTokens ?? []).filter((t) => !basket.some((a) => a.token.mint === t.mint)).filter((t) => !q || t.symbol.toLowerCase().includes(q) || t.name.toLowerCase().includes(q));
  }, [vcfg, basket, basketSearch]);
  const tokenOk = !!name.trim() && !!symbol.trim() && !!logo.trim() && !!description.trim();
  const minEpoch = vcfg?.minEpochLength ?? 600;
  const epochTooShort = (seconds: number) => seconds < minEpoch;
  const effectiveVault = vault ?? (resumed && resumed.status === "pending" && user && resumed.creator === user ? resumed.address : null);
  const resuming = !vault && !!effectiveVault;
  const resumeMintMissing = resuming && !mint;

  const costLeg = cost ? (effectiveVault ? cost.launchOnly : cost.withVault) : null;
  const required = costLeg ? BigInt(costLeg.required) + initialBuyLamports : null;
  const shortBy = required !== null && held !== undefined && held < required ? required - held : null;
  const usd = (lamports: bigint) => (cost?.solUsd ? ` (${formatUsd((Number(lamports) / 1e9) * cost.solUsd)})` : "");

  const add = (t: TokenJson) => {
    setBasket((prev) => (prev.some((x) => x.token.mint === t.mint) || prev.length >= MAX_BASKET ? prev : withAdded(prev, { token: t, weight: 0 })));
    setFocus(t.mint);
  };
  const remove = (m: string) => {
    setBasket((prev) => withRemoved(prev, (x) => x.token.mint === m));
    setFocus(null);
  };
  const balancePair = (k: number, a: number, b: number) => setBasket((prev) => prev.map((x, i) => (i === k ? { ...x, weight: a } : i === k + 1 ? { ...x, weight: b } : x)));
  const distributeEvenly = () => setBasket((prev) => evenWeights(prev));

  async function onCreateVault(): Promise<{ vault: string; mint: Keypair } | null> {
    if (!publicKey || !basketOk) return null;
    const kp = Keypair.generate();
    const salt = BigInt(Date.now()) * 1000n + BigInt(Math.floor(Math.random() * 1000));
    let created = "";
    if (isCustodial) {
      // custodial: the vault is registered server-side (no rent); the wallet only funds its floor + token accounts
      const legs = basket.map((b) => ({ mint: b.token.mint, tokenProgram: b.token.tokenProgram }));
      const res = await fetch("/api/vaults/create", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ creator: publicKey.toBase58(), salt: salt.toString(), legs, weightsBps: basket.map((b) => b.weight * 100), epochLength, expectedMint: kp.publicKey.toBase58(), quoteMint: quote?.mint }),
      });
      const body = (await res.json()) as { address?: string; floorLamports?: string; basket?: { mint: string; tokenProgram: string }[]; quote?: { mint: string; tokenProgram: string }; error?: string };
      if (!res.ok || !body.address) throw new Error(body.error ?? "could not register the vault");
      created = body.address;
      storeMint(created, kp);
      const vaultPk = new PublicKey(created);
      // the floor, one token account per stock, and the quote account StonkFun forwards the creator's fees into
      await tx.run(
        async ({ payer }) => ({
          instructions: prepareVaultIxs({ payer, vault: vaultPk, floorLamports: BigInt(body.floorLamports ?? "1000000"), basket: body.basket ?? legs, quote: body.quote ?? null }),
          computeUnits: 200_000,
        }),
        "Prepare dividend vault",
      );
      setVault(created);
      setMint(kp);
      router.replace(`/launch?vault=${created}&mint=${kp.publicKey.toBase58()}${draftId ? `&draft=${draftId}` : ""}` as Route, { scroll: false });
      return { vault: created, mint: kp };
    }
    await tx.run(async ({ payer }) => {
      const { instructions, vault: pda } = await createVaultIxs(program, {
        creator: payer,
        salt,
        legs: basket.map((b) => ({ mint: new PublicKey(b.token.mint), tokenProgram: new PublicKey(b.token.tokenProgram) })),
        weightsBps: basket.map((b) => b.weight * 100),
        epochLength,
        expectedMint: kp.publicKey,
      });
      created = pda.toBase58();
      storeMint(created, kp);
      return { instructions, computeUnits: 300_000 };
    }, "Create dividend vault");
    setVault(created);
    setMint(kp);
    // Put the vault in the URL straight away: if the launch transaction then fails, a reload resumes at
    // step 2 instead of paying to create a second vault.
    router.replace(`/launch?vault=${created}&mint=${kp.publicKey.toBase58()}${draftId ? `&draft=${draftId}` : ""}` as Route, { scroll: false });
    return { vault: created, mint: kp };
  }

  async function onLaunch(target: string, kp: Keypair) {
    if (!publicKey) return;
    const vaultPda = new PublicKey(target);
    // A previous attempt may have landed even if the wallet reported a problem: the mint exists, so sending
    // create_v2 again would fail with "account already in use" (custom program error 0x0). Move on instead.
    if (await connection.getAccountInfo(kp.publicKey).catch(() => null)) {
      await registerLaunch({ mint: kp.publicKey.toBase58(), quoteMint: quoteMint ?? undefined, name: name.trim(), symbol: symbol.trim().toUpperCase(), uri: "", logo: logo.trim(), description: description.trim(), deployer: user ?? undefined, signature: "", draft: draftId ?? undefined }).catch(() => {});
      router.push(`/vaults/${target}` as Route);
      return;
    }
    let signature = "";
    let uri = "";
    signature = await tx.run(async ({ payer }) => {
      const metaRes = await fetch("/api/launch/metadata", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: name.trim(), symbol: symbol.trim().toUpperCase(), description: description.trim(), image: logo.trim(), ...socials }),
      });
      const meta = (await metaRes.json()) as { uri?: string; error?: string };
      if (!metaRes.ok || !meta.uri) throw new Error(meta.error ?? "could not pin the coin's metadata");
      uri = meta.uri;
      if (!quoteMint) throw new Error("pick the token the coin trades against");
      const priceRes = await fetch(`/api/launch/pricing?quote=${quoteMint}`);
      const pricing = (await priceRes.json()) as LaunchPricing & { error?: string };
      if (!priceRes.ok) throw new Error(pricing.error ?? "could not price the launch");
      const instructions = [createLaunchIx({ pricing, payer, creator: vaultPda, mint: kp.publicKey, name: name.trim(), symbol: symbol.trim().toUpperCase(), uri })];
      // the dev buy is the pool's very first trade, in the same transaction, so nothing can get in before it
      if (initialBuyRaw > 0n) instructions.push(...buyIxs(tradeParamsFromPricing(pricing, kp.publicKey, vaultPda, payer), initialBuyRaw, 1n));
      return { instructions, signers: [kp], computeUnits: 600_000 };
    }, "Launch on StonkFun");
    await registerLaunch({ mint: kp.publicKey.toBase58(), quoteMint: quoteMint ?? undefined, name: name.trim(), symbol: symbol.trim().toUpperCase(), uri, logo: logo.trim(), description: description.trim(), deployer: user ?? undefined, signature, draft: draftId ?? undefined });
    // the bind is a second, permissionless transaction; if the creator closes the tab before signing it, the
    // keeper binds the coin within a couple of minutes anyway.
    // (custodial: there is nothing to sign — the keeper binds as soon as it sees the pool)
    if (!isCustodial) {
      try {
        await tx.run(async () => ({ instructions: [await bindLaunchIx(program, vaultPda, kp.publicKey, quoteMint ? new PublicKey(quoteMint) : undefined)], computeUnits: 100_000 }), "Bind coin to vault");
      } catch {
        // non-fatal: the keeper picks it up
      }
    }
    router.push(`/vaults/${target}` as Route);
  }

  async function onSubmit() {
    if (effectiveVault && mint) return onLaunch(effectiveVault, mint);
    const created = await onCreateVault();
    if (created) await onLaunch(created.vault, created.mint);
  }

  /* ---------------------------------------------------------- gates */

  // Keep editable coin details visible while the financial backend is unavailable.
  // Submission remains disabled until configuration and real pricing are available.

  if (resumed && resumed.status === "pending" && resumed.pendingLaunch) {
    return (
      <Shell>
        <div className="lw-notice">
          <span className="eyebrow">Already launched</span>
          <h2 className="editorial">
            <em>{resumed.pendingLaunch.symbol}</em> is on its way.
          </h2>
          <p>
            This vault is being bound to <span className="num">{resumed.pendingLaunch.symbol}</span>, launched {timeAgo(resumed.pendingLaunch.launchedAt)}. The
            keeper does that automatically, usually within a couple of minutes.
          </p>
          <Link href={`/vaults/${resumed.address}` as Route} className="btn-signal">
            Open the vault
            <ArrowRight size={15} aria-hidden="true" />
          </Link>
        </div>
      </Shell>
    );
  }

  if (resumeMintMissing) {
    return (
      <Shell>
        <div className="lw-notice">
          <span className="eyebrow">Different browser</span>
          <h2 className="editorial">
            This vault&apos;s coin can only be created <em>where it was started.</em>
          </h2>
          <p>
            Vault <span className="num">{shortAddress(effectiveVault!, 6)}</span> committed to a coin whose signing key lives in the browser that created it. Open this
            link there to finish the launch, or start a new vault here.
          </p>
          <Link href={"/launch" as Route} className="btn-signal">
            Start a new vault
            <ArrowRight size={15} aria-hidden="true" />
          </Link>
        </div>
      </Shell>
    );
  }

  /* ---------------------------------------------------------- steps */

  const tokenSummary = tokenOk ? `$${symbol.trim().toUpperCase()} · ${name.trim()}` : "Name, symbol, logo, story";
  const steps = resuming
    ? [
        { key: "token", title: "Coin", done: tokenOk, summary: tokenSummary },
        { key: "launch", title: "Review", done: false, summary: "1 transaction" },
      ]
    : [
        { key: "token", title: "Coin", done: tokenOk, summary: tokenSummary },
        { key: "rewards", title: "Rewards", done: basketOk, summary: basket.length ? `${basket.length} asset${basket.length === 1 ? "" : "s"} · ${fmtDuration(epochLength)}` : "Basket and payout period" },
        { key: "launch", title: "Review", done: false, summary: effectiveVault ? "1 transaction" : "2 transactions" },
      ];
  const canNext = [tokenOk, basketOk, true][step];
  const shareBps = vcfg?.protocolShareBps;
  const isReview = (step === 2 && !resuming) || (step === 1 && resuming);
  const isRewards = step === 1 && !resuming;

  const ribbonItems = basket.map((a) => ({
    key: a.token.mint,
    label: a.token.symbol,
    sub: a.token.name,
    mark: <TokenIcon symbol={a.token.symbol} address={a.token.mint} logoUrl={a.token.logoUrl} size={18} />,
    weight: a.weight,
    color: segmentColor(a.token.mint),
  }));
  const focused = basket.find((a) => a.token.mint === focus) ?? null;

  const overRibbon = (px: number, py: number) => {
    const r = document.querySelector<HTMLElement>(".lw .mc-ribbon")?.getBoundingClientRect();
    if (!r) return false;
    const x = px - window.scrollX;
    const y = py - window.scrollY;
    return x >= r.left && x <= r.right && y >= r.top - 12 && y <= r.bottom + 12;
  };

  const primary = (() => {
    if (step < steps.length - 1) {
      return (
        <Button className="lw-primary" disabled={!canNext} onClick={() => setStep(step + 1)}>
          {step === 0 ? "Choose stock rewards" : "Review your launch"}
          <ArrowRight size={15} aria-hidden="true" />
        </Button>
      );
    }
    if (!user) {
      return (
        <Button className="lw-primary" onClick={() => setVisible(true)}>
          Connect wallet to launch
        </Button>
      );
    }
    return (
      <Button className="lw-primary" loading={tx.busy} disabled={!tokenOk || (!resuming && (!basketOk || !quote)) || !vcfg || vcfg.paused || required === null || held === undefined || shortBy !== null} onClick={onSubmit}>
        {tx.state.status === "confirming" ? "Confirming…" : required === null || held === undefined ? "Waiting for launch checks" : shortBy !== null ? "Not enough SOL" : effectiveVault ? "Launch on StonkFun" : "Create vault & launch"}
      </Button>
    );
  })();

  return (
    <Shell
      preview={<CoinPreview name={name} symbol={symbol} logo={logo} description={description} basket={resuming ? (resumed?.basket ?? []).map(token => ({ token, weight: token.weightBps / 100 })) : basket} epochLength={resuming ? resumed?.epochLength ?? epochLength : epochLength} />}
      rail={
        <>
          <span className="studio-workspace-label">Make it yours <span>CREATE A MARKET</span></span>
          <ol className="lw-steps">
            {steps.map((s, i) => {
              const state = i === step ? "is-active" : i < step ? "is-done" : "is-locked";
              return (
                <li key={s.key}>
                  <button type="button" className={state} disabled={i > step} onClick={() => setStep(i)} aria-current={i === step ? "step" : undefined}>
                    <i className="lw-step-index num">{s.done && i !== step ? <Check size={11} weight="bold" /> : `0${i + 1}`}</i>
                    <span className="lw-step-text">
                      <b>{s.title}</b>
                      <small>{s.summary}</small>
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
          {resuming && (
            <p className="lw-rail-note">
              Resuming vault <span className="num">{shortAddress(effectiveVault!, 6)}</span>: it exists but has no coin yet. Fill in the coin and launch it; the vault will
              be its creator.
            </p>
          )}
          {draftId && draft && <p className="lw-rail-note">Drafted in Telegram. Check it, connect your wallet and sign; the bot messages you there once the coin is live.</p>}
          {draftId && draftError && <p className="lw-rail-note is-danger">Telegram draft: {draftError.message}</p>}
          {activeCluster !== "mainnet-beta" && step === 0 && (
            <p className="studio-testnet-note">Test network · This launch uses Raydium LaunchLab on devnet. StonkFun is mainnet-only.</p>
          )}
        </>
      }
      side={
        <>
          <div className="lw-actions">
            {step === 0 && !tokenOk && <p className="studio-continue-hint">Add {[[name, "a name"], [symbol, "a symbol"], [logo, "artwork"], [description, "a description"]].filter(([value]) => !value.trim()).map(([, label]) => label).join(", ")} to continue.</p>}
            {primary}
            {step > 0 && <button type="button" className="lw-back" onClick={() => setStep(step - 1)}>Back to {step === 1 ? "coin details" : "rewards"}</button>}
            <span className="studio-signing-note">Nothing goes on-chain until you review and sign.</span>
          </div>
          {vcfgError && <div className="studio-service-note" role="status"><span /><p><strong>Launch service is offline.</strong> You can work on your coin details. Stock selection and signing need the service to reconnect.</p><button type="button" disabled={configFetching} onClick={() => void retryConfig()}>{configFetching ? "Checking…" : "Retry"}</button></div>}
          {!user && (
            <div className="lw-wallet">
              <p>Prepare first.<br /><strong>Connect when you’re ready.</strong></p>
              <button type="button" className="btn-quiet" onClick={() => setVisible(true)}>
                Connect wallet
              </button>
            </div>
          )}

          {isReview && costLeg && required !== null && (
            <dl className="lw-cost">
              <div>
                <dt>Wallet needs</dt>
                <dd className="num">
                  {formatSol(required)}
                  {usd(required)}
                </dd>
              </div>
              <div>
                <dt>Costs about</dt>
                <dd className="num">
                  {formatSol(BigInt(costLeg.spend) + initialBuyLamports)}
                  {usd(BigInt(costLeg.spend) + initialBuyLamports)}
                </dd>
              </div>
              {held !== undefined && (
                <div>
                  <dt>You hold</dt>
                  <dd className={cx("num", shortBy ? "is-neg" : "is-pos")}>
                    {formatSol(held)}
                    {usd(held)}
                  </dd>
                </div>
              )}
              <p>
                {formatSol(BigInt(cost!.vaultRent))} of that is rent for the vault and its token accounts; {formatSol(BigInt(cost!.createCost))} is rent for the coin&apos;s mint, curve and vaults — StonkFun charges no launch fee.
                {initialBuyLamports > 0n && <> Your initial buy of {formatSol(initialBuyLamports)} is on top.</>}
              </p>
            </dl>
          )}

          {vcfg?.paused && <p className="lw-rail-note is-danger">Vault creation is paused by the protocol admin.</p>}
        </>
      }
    >
      {step === 0 && (
        <motion.div key="token" className="lw-step" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.28 }}>
          <header className="lw-head">
            <span className="eyebrow">Step 1 of {steps.length}</span>
            <h2 className="editorial" ref={stepHeading} tabIndex={-1}>
              Give your idea <em>an identity.</em>
            </h2>
            <p>Name it. Tell the story. Make it unmistakably yours.</p>
            {saveState && <span className="studio-save-state">{saveState === "saved" ? "Coin details saved on this device" : "Device storage is unavailable — keep this tab open"}</span>}
          </header>

          <div className="lw-group">
            <span className="lw-group-title">Coin details <span>01</span></span>
            <div className="lw-fields lw-fields-2">
              <Field label="Name" htmlFor="coin-name" required hint={`${name.length}/32`}>
                <Input id="coin-name" placeholder="e.g. The AI Stack" maxLength={32} value={name} onChange={(e) => setName(e.target.value.slice(0, 32))} />
              </Field>
              <Field label="Symbol" htmlFor="coin-symbol" required hint={`${symbol.length}/10`}>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-faint pointer-events-none num">$</span>
                  <Input id="coin-symbol" placeholder="STACK" className="pl-6 num uppercase" value={symbol} onChange={(e) => setSymbol(e.target.value.replace(/^\$/, "").slice(0, 10))} />
                </div>
              </Field>
            </div>
            <Field label="Logo" required hint="PNG, JPEG, WebP, GIF or SVG · max 2 MB">
              <LogoPicker value={logo} onChange={setLogo} />
            </Field>
            <Field label="Description" htmlFor="coin-description" required hint={`${description.length}/280`}>
              <Textarea id="coin-description" rows={3} maxLength={280} placeholder="What is this coin, and why should someone hold it?" value={description} onChange={(e) => setDescription(e.target.value.slice(0, 280))} />
            </Field>
            <button type="button" className="lw-disclosure" onClick={() => setShowSocials((v) => !v)} aria-expanded={showSocials}>
              <CaretRight size={13} style={{ transform: showSocials ? "rotate(90deg)" : "none" }} />
              Social links
              <span>{socialCount > 0 ? `· ${socialCount} added` : "· optional"}</span>
            </button>
            {showSocials && (
              <div className="lw-fields lw-fields-2">
                {SOCIALS.map((k) => (
                  <Field key={k} label={k[0].toUpperCase() + k.slice(1)} htmlFor={`social-${k}`}>
                    <Input id={`social-${k}`} placeholder={SOCIAL_PLACEHOLDER[k]} value={socials[k]} onChange={(e) => setSocials((prev) => ({ ...prev, [k]: e.target.value }))} />
                  </Field>
                ))}
              </div>
            )}
          </div>

          <div className="lw-group">
            <span className="lw-group-title">Economics</span>
            <Field label="Trades against" required hint="Creator fees arrive in this token">
              {pairsError ? <div className="studio-service-note"><p>Quote tokens are unavailable.</p><button type="button" disabled={pairsFetching} onClick={() => void retryPairs()}>Retry</button></div> : <QuotePicker pairs={pairs ?? []} value={quote} onChange={setQuote} loading={pairsFetching} />}
            </Field>
            <div className="lw-fields lw-fields-2">
              <Field label="Initial buy" htmlFor="initial-buy" hint={`Optional · ${quoteSymbol}`}>
                <Input id="initial-buy" inputMode="decimal" placeholder="0" className="num" value={initialBuy} onChange={(e) => setInitialBuy(e.target.value.replace(/[^\d.]/g, ""))} />
              </Field>
              <Field label="Creator fee" hint="StonkFun standard pool">
                <div className="lw-locked">
                  <b className="num">{CREATOR_FEE_PCT}%</b>
                  <span>· of every trade on the curve</span>
                </div>
              </Field>
            </div>
            <p className="lw-hint lw-hint-rule">
              Holders see this as <b>&quot;{CREATOR_FEE_PCT}% of every trade is paid out in stocks&quot;</b>. StonkFun charges 1% on every curve trade and forwards half of it
              to the coin&apos;s creator — the vault — in {quoteSymbol}; that is what becomes stock dividends{shareBps === undefined ? ". The LINKR share will be confirmed when configuration is available" : shareBps === 0 ? " — LINKR takes 0% of it" : ` (LINKR keeps ${shareBps / 100}% of it)`}.
            </p>
          </div>
        </motion.div>
      )}

      {isRewards && (
        <motion.div key="rewards" className="lw-step" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.28 }}>
          <header className="lw-head">
            <span className="eyebrow">Step 2 of 3 · Reward split</span>
            <h2 className="editorial" ref={stepHeading} tabIndex={-1}>
              Pay holders in <em className="num">{basket.length}</em> {basket.length === 1 ? "asset" : "assets"}.
            </h2>
            <p>
              Creator fees are converted into this basket of xStocks and paid to holders pro rata to how much they held, and for how long, each period. The basket is
              fixed for the life of the coin. Drag a divider to rebalance; drop an asset from the shelf to add it.
            </p>
          </header>

          <RewardRibbon items={ribbonItems} onBalance={balancePair} focus={focus} onFocus={setFocus} onRemove={remove} step={1} min={1} over={over} ariaLabel="Reward split, whole percents" />
          {vcfgError && <div className="studio-service-note"><span /><p><strong>The stock catalog is unavailable.</strong> Your coin details are still here. Return to the first step to keep editing; a verified catalog is required to choose rewards.</p></div>}

          <div className="mc-detail" aria-live="polite">
            {focused ? (
              <>
                <span className="mc-detail-mark">
                  <TokenIcon symbol={focused.token.symbol} address={focused.token.mint} logoUrl={focused.token.logoUrl} size={20} />
                </span>
                <span className="mc-detail-text">
                  <b>{focused.token.name}</b>
                  <small>
                    {focused.token.kind === "xstock" ? "Tokenised stock" : "Token"} · <span className="num">{focused.weight}%</span> of every payout
                  </small>
                </span>
                <button type="button" className="mc-remove" onClick={() => remove(focused.token.mint)} aria-label={`Remove ${focused.token.symbol}`}>
                  <X size={12} weight="bold" />
                  Remove
                </button>
              </>
            ) : (
              <span className="mc-detail-hint">{basket.length ? `Total ${totalWeight}% · select a segment for details · Backspace removes it` : "Pick at least one stock from the shelf."}</span>
            )}
            {basket.length > 1 && (
              <button type="button" className="lw-even" onClick={distributeEvenly}>
                Distribute evenly
              </button>
            )}
          </div>

          <div className="mc-shelf">
            <div className="lw-shelf-head">
              <span className="eyebrow">
                Assets <em className="num">{basket.length} / {MAX_BASKET}</em>
              </span>
              <label className="lw-search">
                <MagnifyingGlass size={13} aria-hidden="true" />
                <input value={basketSearch} onChange={(e) => setBasketSearch(e.target.value)} placeholder={`Search ${vcfg?.basketTokens.length ?? 0} stocks`} aria-label="Search stocks" />
              </label>
            </div>
            <div className="mc-shelf-row lw-shelf-scroll">
              {pickable.map((t) => (
                <motion.button
                  key={t.mint}
                  type="button"
                  className={`mc-chip ${basket.length >= MAX_BASKET ? "is-full" : ""}`}
                  disabled={basket.length >= MAX_BASKET}
                  drag={basket.length < MAX_BASKET}
                  dragSnapToOrigin
                  dragMomentum={false}
                  dragElastic={0.12}
                  whileDrag={{ scale: 1.08, zIndex: 20 }}
                  whileTap={{ scale: 0.96 }}
                  onDragStart={() => (dragged.current = true)}
                  onDrag={(_, info) => setOver(overRibbon(info.point.x, info.point.y))}
                  onDragEnd={(_, info) => {
                    setOver(false);
                    if (overRibbon(info.point.x, info.point.y)) add(t);
                    window.setTimeout(() => (dragged.current = false), 0);
                  }}
                  onTap={() => {
                    if (dragged.current) return;
                    add(t);
                  }}
                  aria-label={`Add ${t.symbol}`}
                >
                  <TokenIcon symbol={t.symbol} address={t.mint} logoUrl={t.logoUrl} size={18} />
                  <span>
                    <b>{t.symbol}</b>
                    <small>{t.name}</small>
                  </span>
                </motion.button>
              ))}
              {vcfg && pickable.length === 0 && <p className="mc-detail-hint">{basketSearch ? `No stock matches "${basketSearch}".` : (vcfg.basketTokens?.length ?? 0) > 0 ? "Every allowlisted stock is already in the basket." : "No basket mints are allowlisted yet — the admin allowlists xStocks from /admin."}</p>}
            </div>
          </div>

          <div className="lw-group">
            <span className="lw-group-title">Payout period</span>
            <div className="mc-shelf-row">
              {EPOCH_OPTIONS.map((o) => (
                <button
                  key={o.seconds}
                  type="button"
                  disabled={epochTooShort(o.seconds)}
                  title={epochTooShort(o.seconds) ? `The minimum payout period is ${fmtDuration(minEpoch)}` : undefined}
                  onClick={() => setEpochLength(o.seconds)}
                  aria-pressed={epochLength === o.seconds}
                  className={`mc-chip lw-pill ${epochLength === o.seconds ? "is-in" : ""} ${epochTooShort(o.seconds) ? "opacity-40 cursor-not-allowed" : ""}`}
                >
                  <b>{o.label}</b>
                </button>
              ))}
            </div>
            <p className="lw-hint">
              Each period ends with a snapshot of time-weighted balances. After a{" "}
              {vcfg ? fmtDuration(reviewWindowFor(epochLength, vcfg.disputeWindow)) : "short"} review window the stocks are airdropped to every holder&apos;s wallet, so
              they land before the next period ends.
            </p>
          </div>
        </motion.div>
      )}

      {isReview && (
        <motion.div key="review" className="lw-step" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.28 }}>
          <header className="lw-head">
            <span className="eyebrow">{resuming ? "Step 2 of 2" : "Step 3 of 3"}</span>
            <h2 className="editorial" ref={stepHeading} tabIndex={-1}>
              {resuming ? "Launch" : "Review &"} <em>{resuming ? "the coin." : "launch."}</em>
            </h2>
            <p>
              {effectiveVault
                ? "One transaction: create the coin on StonkFun with the vault as its creator, and bind it."
                : isCustodial
                  ? "Two transactions: prepare the vault wallet, then create the coin on StonkFun with it as creator. If the second one fails you can retry it from here or from the vault page."
                  : "Two transactions: create the vault, then create the coin on StonkFun with the vault as its creator. If the second one fails you can retry it from here or from the vault page."}
            </p>
          </header>

          <dl className="lw-review">
            <div>
              <dt>Coin</dt>
              <dd>
                {name.trim()} <span className="num">(${symbol.trim().toUpperCase()})</span>
              </dd>
            </div>
            <div>
              <dt>Trades against</dt>
              <dd className="num">{quoteSymbol}</dd>
            </div>
            <div>
              <dt>Initial buy · creator fee</dt>
              <dd>
                <span className="num">{initialBuyRaw > 0n ? `${initialBuy} ${quoteSymbol}` : "none"}</span> · <span className="num">{CREATOR_FEE_PCT}%</span>
              </dd>
            </div>
            <div className="is-wide">
              <dt>Basket</dt>
              <dd>{resuming ? (resumed?.basket ?? []).map((b) => `${b.weightBps / 100}% ${b.symbol}`).join(" · ") : <RewardRibbon items={ribbonItems} onBalance={balancePair} step={1} min={1} ariaLabel="Reward split" />}</dd>
            </div>
            <div>
              <dt>Payout period</dt>
              <dd>{fmtDuration(resuming ? (resumed?.epochLength ?? epochLength) : epochLength)}</dd>
            </div>
            <div>
              <dt>LINKR share</dt>
              <dd>
                {shareBps === undefined ? "Awaiting protocol configuration" : <><span className="num">{shareBps / 100}%</span> {shareBps === 0 ? "— every harvested fee goes to holders" : "of harvested fees"}</>}
              </dd>
            </div>
            <div>
              <dt>Vault</dt>
              <dd>
                {effectiveVault ? (
                  <a className="num" href={explorerAddressUrl(effectiveVault)} target="_blank" rel="noreferrer">
                    {shortAddress(effectiveVault, 6)}
                    <ArrowUpRight size={12} aria-hidden="true" />
                  </a>
                ) : (
                  "created in the first transaction"
                )}
              </dd>
            </div>
            {mint && (
              <div>
                <dt>Mint</dt>
                <dd className="num">{shortAddress(mint.publicKey.toBase58(), 6)}</dd>
              </div>
            )}
          </dl>

          {shortBy !== null && required !== null && held !== undefined && (
            <Callout tone="danger">
              <span className="font-medium">Not enough SOL on {clusterLabel[activeCluster]} to launch.</span> You need{" "}
              <span className="num">
                {formatSol(required)}
                {usd(required)}
              </span>{" "}
              and hold{" "}
              <span className="num">
                {formatSol(held)}
                {usd(held)}
              </span>
              , so top up at least{" "}
              <span className="num font-medium">
                {formatSol(shortBy)}
                {usd(shortBy)}
              </span>
              . Send SOL to <span className="num">{user ? shortAddress(user, 6) : "your wallet"}</span>, then this updates on its own.
            </Callout>
          )}
          {vault && (
            <Callout tone="info">
              Vault created at <span className="num">{shortAddress(vault, 6)}</span>. Now create the coin — step 2 of 2.
            </Callout>
          )}
        </motion.div>
      )}
    </Shell>
  );
}

/** The sculpture/preview and glass workspace, shared by the wizard and its gates. */
function Shell({ rail, side, preview, children }: { rail?: React.ReactNode; side?: React.ReactNode; preview?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="lw launch-studio" aria-label="Create a market">
      <aside className="studio-visual"><LaunchSculpture />{preview}<div className="studio-principle"><span className="studio-principle-line" /><p>A coin is the beginning.<br /><strong>The connection is what makes it LINKR.</strong></p></div></aside>
      <div className="studio-workspace">
        <div className="lw-rail">{rail}</div>
        <div className="lw-main">{children}</div>
        <aside className="lw-side">{side}</aside>
      </div>
    </section>
  );
}
