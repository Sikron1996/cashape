# Cash Apes Community Site

Black community/gallery site for Cash Apes on Robinhood Chain.

## Included
- Cash Apes contract: `0xfc956643FbE881C06D89e1B55355D7DcB42e79E6`
- Robinhood Chain ID: `4663` (`0x1237`)
- WalletConnect/Reown Project ID reused from the supplied Skeleton project.
- Collection browser with token-ID search and pagination.
- Connected-wallet `My Apes` page.
- Grid Builder: select up to 16 owned NFTs, choose 2/3/4 columns, export PNG.
- Supplied Cash Apes banner integrated into the hero section.
- Metadata fallback base: `https://ipfs.io/ipfs/QmcvsAep4iVw2MKzKrSRzwsvQ447ZScNK4MNbVkJkJK3cY/`

## Run
```bash
npm install
npm run dev
```

## Deploy to Vercel
Upload/push this folder to GitHub and import it into Vercel. Framework preset: Vite. Build command: `npm run build`. Output: `dist`.

## Notes
The site first asks the NFT contract for `tokenURI(tokenId)`. If that is unavailable, it falls back to the supplied IPFS metadata path. `My Apes` first tries ERC-721 Enumerable and then the Robinhood Chain Blockscout NFT endpoint.
