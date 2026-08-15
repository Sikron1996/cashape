# Cash Apes Community Site

Compact black community site for Cash Apes on Robinhood Chain.

## Included
- Collection: `/`
- My Apes: `/my-apes`
- Grid Builder: `/grid-builder`
- Clean URLs via `vercel.json` (no `.html`)
- OpenSea + X links
- WalletConnect/Reown AppKit connection
- Cash Apes contract: `0xfc956643FbE881C06D89e1B55355D7DcB42e79E6`
- Robinhood Chain ID: `4663`
- Metadata base: `https://ipfs.io/ipfs/QmcvsAep4iVw2MKzKrSRzwsvQ447ZScNK4MNbVkJkJK3cY/`
- Favicon created from the supplied Cash Ape image

## My Apes fix
The wallet NFT lookup now reads Blockscout v2's ERC-721 contract field from `token.address_hash`. The previous build checked the wrong field (`token.address`), which could make owned Cash Apes appear as not found. If explorer indexing is incomplete, the site compares against on-chain `balanceOf` and falls back to `ownerOf` checks.

## Deploy
```bash
npm install
npm run build
```
Deploy the project root to Vercel. The included `vercel.json` keeps `/my-apes` and `/grid-builder` working on refresh without `.html`.
