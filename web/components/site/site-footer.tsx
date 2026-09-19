import Link from "next/link";
import {BrandLockup} from "./brand";
export function SiteFooter(){return <footer className="lk-footer"><div className="footer-line"/><Link href="/" className="lk-logo"><BrandLockup/></Link><p>Ideas connected.<br/>Possibilities multiplied.</p><nav aria-label="Footer"><Link href="/news">Newswire</Link><Link href="/vaults">Markets</Link><Link href="/launch">Create</Link><Link href="/claims">Portfolio</Link></nav><span>Built on Solana · LINKR<br/><small>Tokenised equity rewards carry risk. Payouts depend on fees received.</small></span></footer>}
