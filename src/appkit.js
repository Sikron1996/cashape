import { createAppKit } from "@reown/appkit/react";
import { EthersAdapter } from "@reown/appkit-adapter-ethers";
import { SITE_CONFIG } from "./config";

export const robinhoodChain = {
  id: SITE_CONFIG.chainId,
  caipNetworkId: SITE_CONFIG.caipNetworkId,
  chainNamespace: "eip155",
  name: SITE_CONFIG.chainName,
  nativeCurrency: SITE_CONFIG.nativeCurrency,
  rpcUrls: { default: { http: [SITE_CONFIG.rpcUrl] } },
  blockExplorers: {
    default: { name: "Robinhood Chain Explorer", url: SITE_CONFIG.explorerBaseUrl }
  }
};

const metadata = {
  name: "Cash Apes",
  description: "Cash Apes community gallery and NFT grid builder on Robinhood Chain",
  url: typeof window !== "undefined" ? window.location.origin : "https://cash-apes.vercel.app",
  icons: [typeof window !== "undefined" ? `${window.location.origin}/cash-apes-banner.jpeg` : ""]
};

createAppKit({
  adapters: [new EthersAdapter()],
  networks: [robinhoodChain],
  defaultNetwork: robinhoodChain,
  projectId: SITE_CONFIG.walletConnectProjectId,
  metadata,
  themeMode: "dark",
  themeVariables: {
    "--w3m-accent": "#c8ff00",
    "--w3m-border-radius-master": "2px"
  },
  features: { analytics: true, email: false, socials: [] }
});
