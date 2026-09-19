import { GithubLogo, XLogo } from "@phosphor-icons/react/ssr";
import { ArrowUpRight } from "@/components/ui/icons";
import { BRAND } from "@/lib/brand";
import { COIN_URL, TOKEN, TOKEN_IS_LIVE } from "@/lib/token";

/** The $LINKR ticker: a link to the coin on StonkFun once it's live, a quiet "soon" badge until then. */
export function LinkrTicker({ className = "" }: { className?: string }) {
  if (!TOKEN_IS_LIVE) {
    return (
      <span className={`linkr-ticker is-soon ${className}`} title="Launching soon on StonkFun">
        <i aria-hidden="true" />${TOKEN.symbol}
        <small>soon</small>
      </span>
    );
  }
  return (
    <a className={`linkr-ticker ${className}`} href={COIN_URL} target="_blank" rel="noopener noreferrer" aria-label={`$${TOKEN.symbol} on StonkFun`}>
      <i aria-hidden="true" />${TOKEN.symbol}
      <ArrowUpRight size={13} />
    </a>
  );
}

/** X and GitHub, as icon links. Brand marks come from Phosphor so their shapes are the real ones. */
export function SocialLinks({ className = "" }: { className?: string }) {
  return (
    <span className={`linkr-socials ${className}`}>
      <a href={BRAND.x} target="_blank" rel="noopener noreferrer" aria-label={`${BRAND.name} on X`} title="X">
        <XLogo size={17} weight="regular" aria-hidden="true" />
      </a>
      <a href={BRAND.github} target="_blank" rel="noopener noreferrer" aria-label={`${BRAND.name} on GitHub`} title="GitHub">
        <GithubLogo size={18} weight="regular" aria-hidden="true" />
      </a>
    </span>
  );
}
