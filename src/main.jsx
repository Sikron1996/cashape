import React, { useCallback, useEffect, useMemo, useState } from "react";
import ReactDOM from "react-dom/client";
import { Contract, JsonRpcProvider } from "ethers";
import { Download, ExternalLink, Grid2X2, Images, Search, Wallet, X } from "lucide-react";
import { useAppKit, useAppKitAccount } from "@reown/appkit/react";
import { NFT_ABI } from "./abi";
import { SITE_CONFIG } from "./config";
import "./appkit";
import "./styles.css";

const provider = new JsonRpcProvider(SITE_CONFIG.rpcUrl);
const contract = new Contract(SITE_CONFIG.contractAddress, NFT_ABI, provider);

function shortAddress(address) {
  return address ? `${address.slice(0, 6)}...${address.slice(-4)}` : "";
}

function ipfsToHttp(uri = "") {
  if (!uri) return "";
  if (uri.startsWith("ipfs://")) return `${SITE_CONFIG.ipfsGateway}${uri.slice(7)}`;
  return uri;
}

async function fetchJson(url) {
  const res = await fetch(url, { cache: "force-cache" });
  if (!res.ok) throw new Error(`Metadata ${res.status}`);
  return res.json();
}

async function getTokenData(tokenId) {
  let metadataUrl = "";
  try {
    metadataUrl = ipfsToHttp(await contract.tokenURI(tokenId));
  } catch {
    metadataUrl = `${SITE_CONFIG.metadataGatewayBase}${tokenId}`;
  }

  let meta = null;
  try {
    meta = await fetchJson(metadataUrl);
  } catch {
    // Some collections use .json filenames even when a base URI is provided.
    try { meta = await fetchJson(`${SITE_CONFIG.metadataGatewayBase}${tokenId}.json`); } catch { /* card fallback below */ }
  }

  const image = ipfsToHttp(meta?.image || meta?.image_url || "");
  return {
    id: Number(tokenId),
    name: meta?.name || `Cash Ape #${tokenId}`,
    image,
    attributes: Array.isArray(meta?.attributes) ? meta.attributes : []
  };
}

function TokenCard({ token, selected, onToggle, selectable = false }) {
  return (
    <article className={`ape-card ${selected ? "selected" : ""}`} onClick={() => selectable && onToggle?.(token)}>
      <div className="ape-image-wrap">
        {token.image ? (
          <img src={token.image} alt={token.name} loading="lazy" />
        ) : (
          <div className="image-fallback">APE<br />#{token.id}</div>
        )}
        {selectable && <div className="select-badge">{selected ? "SELECTED" : "SELECT"}</div>}
      </div>
      <div className="ape-meta">
        <strong>{token.name}</strong>
        <span>#{token.id}</span>
      </div>
    </article>
  );
}

async function loadOwnerTokensViaEnumerable(owner) {
  const balance = Number(await contract.balanceOf(owner));
  const ids = [];
  for (let start = 0; start < balance; start += 20) {
    const batch = Array.from({ length: Math.min(20, balance - start) }, (_, j) => start + j);
    const found = await Promise.all(batch.map(i => contract.tokenOfOwnerByIndex(owner, i)));
    ids.push(...found.map(Number));
  }
  return ids;
}

async function loadOwnerTokensViaBlockscout(owner) {
  const ids = [];
  let next = null;
  for (let page = 0; page < 20; page++) {
    const u = new URL(`${SITE_CONFIG.explorerBaseUrl}/api/v2/addresses/${owner}/nft`);
    u.searchParams.set("type", "ERC-721");
    if (next) Object.entries(next).forEach(([k, v]) => u.searchParams.set(k, String(v)));
    const res = await fetch(u);
    if (!res.ok) throw new Error("Explorer NFT lookup failed");
    const data = await res.json();
    const items = Array.isArray(data.items) ? data.items : [];
    for (const item of items) {
      const tokenAddress = (item.token?.address || item.address || "").toLowerCase();
      if (tokenAddress === SITE_CONFIG.contractAddress.toLowerCase()) {
        const rawId = item.id ?? item.token_id ?? item.tokenId;
        if (rawId !== undefined) ids.push(Number(rawId));
      }
    }
    next = data.next_page_params;
    if (!next) break;
  }
  return [...new Set(ids)].filter(Number.isFinite);
}

function App() {
  const { open } = useAppKit();
  const { address, isConnected } = useAppKitAccount();
  const [tab, setTab] = useState("collection");
  const [minted, setMinted] = useState(SITE_CONFIG.supply);
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState("");
  const [tokens, setTokens] = useState([]);
  const [collectionBusy, setCollectionBusy] = useState(false);
  const [myTokens, setMyTokens] = useState([]);
  const [myBusy, setMyBusy] = useState(false);
  const [myStatus, setMyStatus] = useState("");
  const [selected, setSelected] = useState([]);
  const [gridSize, setGridSize] = useState(3);
  const [gridBusy, setGridBusy] = useState(false);

  useEffect(() => {
    contract.totalSupply().then(v => setMinted(Number(v))).catch(() => {});
  }, []);

  const maxPage = Math.max(1, Math.ceil(Math.max(minted, SITE_CONFIG.supply) / SITE_CONFIG.pageSize));

  const loadCollectionPage = useCallback(async () => {
    setCollectionBusy(true);
    try {
      let ids;
      const q = query.trim();
      if (/^\d+$/.test(q)) {
        const id = Number(q);
        ids = id >= 0 && id <= SITE_CONFIG.supply ? [id] : [];
      } else {
        const first = (page - 1) * SITE_CONFIG.pageSize + 1;
        const last = Math.min(first + SITE_CONFIG.pageSize - 1, Math.max(minted, SITE_CONFIG.supply));
        ids = Array.from({ length: Math.max(0, last - first + 1) }, (_, i) => first + i);
      }
      const data = await Promise.all(ids.map(getTokenData));
      setTokens(data);
    } finally {
      setCollectionBusy(false);
    }
  }, [page, query, minted]);

  useEffect(() => { loadCollectionPage(); }, [loadCollectionPage]);

  const loadMyApes = useCallback(async () => {
    if (!address) return;
    setMyBusy(true);
    setMyStatus("Finding your Cash Apes…");
    try {
      let ids = [];
      try {
        ids = await loadOwnerTokensViaEnumerable(address);
      } catch {
        ids = await loadOwnerTokensViaBlockscout(address);
      }
      ids.sort((a, b) => a - b);
      setMyStatus(ids.length ? `${ids.length} Cash Ape${ids.length === 1 ? "" : "s"} found.` : "No Cash Apes found in this wallet.");
      const data = [];
      for (let start = 0; start < ids.length; start += 16) {
        data.push(...await Promise.all(ids.slice(start, start + 16).map(getTokenData)));
      }
      setMyTokens(data);
    } catch (e) {
      console.error(e);
      setMyTokens([]);
      setMyStatus("Could not load wallet NFTs. Try again in a moment.");
    } finally {
      setMyBusy(false);
    }
  }, [address]);

  useEffect(() => {
    if (isConnected && (tab === "my" || tab === "grid")) loadMyApes();
  }, [isConnected, tab, loadMyApes]);

  function toggleSelected(token) {
    setSelected(current => {
      if (current.some(t => t.id === token.id)) return current.filter(t => t.id !== token.id);
      if (current.length >= 16) return current;
      return [...current, token];
    });
  }

  const selectedIds = useMemo(() => new Set(selected.map(t => t.id)), [selected]);

  async function imageToObjectUrl(url) {
    const r = await fetch(url);
    if (!r.ok) throw new Error("Image fetch failed");
    return URL.createObjectURL(await r.blob());
  }

  async function createGrid() {
    if (!selected.length) return;
    setGridBusy(true);
    const cols = Math.max(1, Math.min(gridSize, selected.length));
    const rows = Math.ceil(selected.length / cols);
    const cell = 760;
    const header = 300;
    const footer = 150;
    const canvas = document.createElement("canvas");
    canvas.width = cols * cell;
    canvas.height = header + rows * cell + footer;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#050505";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.textAlign = "center";
    ctx.fillStyle = "#c8ff00";
    ctx.font = `900 ${Math.min(150, canvas.width / 7)}px Arial Black, Arial`;
    ctx.fillText("CASH APES", canvas.width / 2, 145);
    ctx.fillStyle = "#ffffff";
    ctx.font = `700 ${Math.min(64, canvas.width / 18)}px Arial`;
    ctx.fillText(`${selected.length} APES • ROBINHOOD CHAIN`, canvas.width / 2, 235);

    const objectUrls = [];
    try {
      for (let i = 0; i < selected.length; i++) {
        const token = selected[i];
        const x = (i % cols) * cell;
        const y = header + Math.floor(i / cols) * cell;
        ctx.fillStyle = "#111";
        ctx.fillRect(x + 8, y + 8, cell - 16, cell - 16);
        if (token.image) {
          const objectUrl = await imageToObjectUrl(token.image);
          objectUrls.push(objectUrl);
          const img = new Image();
          await new Promise((resolve, reject) => { img.onload = resolve; img.onerror = reject; img.src = objectUrl; });
          const scale = Math.max(cell / img.width, cell / img.height);
          const w = img.width * scale;
          const h = img.height * scale;
          ctx.save();
          ctx.beginPath();
          ctx.rect(x + 10, y + 10, cell - 20, cell - 20);
          ctx.clip();
          ctx.drawImage(img, x + (cell - w) / 2, y + (cell - h) / 2, w, h);
          ctx.restore();
        }
        ctx.fillStyle = "rgba(0,0,0,.72)";
        ctx.fillRect(x + 24, y + cell - 92, 220, 56);
        ctx.fillStyle = "#c8ff00";
        ctx.textAlign = "left";
        ctx.font = "800 28px Arial";
        ctx.fillText(`#${token.id}`, x + 42, y + cell - 54);
      }
      ctx.textAlign = "center";
      ctx.fillStyle = "#888";
      ctx.font = `700 ${Math.min(34, canvas.width / 30)}px Arial`;
      ctx.fillText("CASH APES • COMMUNITY GRID", canvas.width / 2, canvas.height - 62);

      const a = document.createElement("a");
      a.download = `cash-apes-grid-${selected.length}.png`;
      a.href = canvas.toDataURL("image/png");
      a.click();
    } catch (e) {
      console.error(e);
      alert("Grid export was blocked by the image gateway. Try again in a moment.");
    } finally {
      objectUrls.forEach(URL.revokeObjectURL);
      setGridBusy(false);
    }
  }

  return (
    <main>
      <header className="topbar">
        <a className="brand" href="#top">CASH APES</a>
        <nav>
          <button onClick={() => setTab("collection")} className={tab === "collection" ? "active" : ""}>COLLECTION</button>
          <button onClick={() => setTab("my")} className={tab === "my" ? "active" : ""}>MY APES</button>
          <button onClick={() => setTab("grid")} className={tab === "grid" ? "active" : ""}>GRID BUILDER</button>
          <a className="nav-link" href={SITE_CONFIG.openSeaUrl} target="_blank" rel="noreferrer">OPENSEA <ExternalLink size={14}/></a>
          <a className="nav-link" href={SITE_CONFIG.xUrl} target="_blank" rel="noreferrer">X <X size={15}/></a>
          <a href={`${SITE_CONFIG.explorerBaseUrl}/address/${SITE_CONFIG.contractAddress}`} target="_blank" rel="noreferrer" aria-label="Explorer"><ExternalLink size={17}/></a>
        </nav>
        <button className="wallet-button" onClick={() => open({ view: isConnected ? "Account" : "Connect" })}>
          <Wallet size={17}/>{isConnected ? shortAddress(address) : "CONNECT"}
        </button>
      </header>

      <section id="top" className="hero">
        <img src="/cash-apes-banner.jpeg" alt="Cash Apes" />
        <div className="hero-shade" />
        <div className="hero-copy">
          <div className="chain-pill">ROBINHOOD CHAIN</div>
          <h1>CASH<br/>APES</h1>
          <p>10,000 apes. All different. Straight out of the jungle.</p>
          <div className="hero-stats">
            <div><span>SUPPLY</span><strong>10,000</strong></div>
            <div><span>MINTED</span><strong>{minted.toLocaleString()}</strong></div>
            <div><span>STATUS</span><strong className="lime">SOLD OUT</strong></div>
          </div>
        </div>
      </section>

      <section className="workspace">
        {tab === "collection" && <>
          <div className="section-head">
            <div><span className="kicker">THE JUNGLE</span><h2>Collection</h2></div>
            <label className="search"><Search size={18}/><input value={query} onChange={e => { setQuery(e.target.value); setPage(1); }} placeholder="Search token ID" /></label>
          </div>
          {collectionBusy ? <div className="loading">LOADING APES…</div> : <div className="nft-grid">{tokens.map(t => <TokenCard key={t.id} token={t}/>)}</div>}
          {!query && <div className="pager"><button disabled={page <= 1} onClick={() => setPage(p => p - 1)}>← PREV</button><span>{page} / {maxPage}</span><button disabled={page >= maxPage} onClick={() => setPage(p => p + 1)}>NEXT →</button></div>}
        </>}

        {tab === "my" && <>
          <div className="section-head"><div><span className="kicker">YOUR WALLET</span><h2>My Apes</h2></div></div>
          {!isConnected ? <ConnectPanel open={open}/> : <>
            <div className="wallet-summary"><span>{shortAddress(address)}</span><strong>{myStatus || "Ready"}</strong><button onClick={loadMyApes} disabled={myBusy}>{myBusy ? "LOADING…" : "REFRESH"}</button></div>
            <div className="nft-grid">{myTokens.map(t => <TokenCard key={t.id} token={t}/>)}</div>
          </>}
        </>}

        {tab === "grid" && <>
          <div className="section-head"><div><span className="kicker">MAKE IT YOURS</span><h2>Grid Builder</h2><p>Select up to 16 of your Cash Apes and export one shareable PNG.</p></div></div>
          {!isConnected ? <ConnectPanel open={open}/> : <>
            <div className="builder-bar">
              <div><span>SELECTED</span><strong>{selected.length} / 16</strong></div>
              <div className="grid-size"><span>COLUMNS</span>{[2,3,4].map(n => <button key={n} className={gridSize === n ? "active" : ""} onClick={() => setGridSize(n)}>{n}</button>)}</div>
              <button className="download" disabled={!selected.length || gridBusy} onClick={createGrid}><Download size={18}/>{gridBusy ? "BUILDING…" : "CREATE PNG"}</button>
            </div>
            {myBusy && <div className="loading">LOADING YOUR APES…</div>}
            {!myBusy && !myTokens.length && <div className="empty">{myStatus || "No Cash Apes loaded."}</div>}
            <div className="nft-grid">{myTokens.map(t => <TokenCard key={t.id} token={t} selectable selected={selectedIds.has(t.id)} onToggle={toggleSelected}/>)}</div>
          </>}
        </>}
      </section>

      <footer>
        <span>CASH APES • #BAYC 2.0 • ROBINHOOD CHAIN</span>
        <div className="footer-links">
          <a href={SITE_CONFIG.openSeaUrl} target="_blank" rel="noreferrer">OPENSEA <ExternalLink size={13}/></a>
          <a href={SITE_CONFIG.xUrl} target="_blank" rel="noreferrer">X <X size={13}/></a>
          <a href={`${SITE_CONFIG.explorerBaseUrl}/address/${SITE_CONFIG.contractAddress}`} target="_blank" rel="noreferrer">CONTRACT <ExternalLink size={13}/></a>
        </div>
      </footer>
    </main>
  );
}

function ConnectPanel({ open }) {
  return <div className="connect-panel"><Grid2X2 size={38}/><h3>Connect your wallet</h3><p>Connect to see the Cash Apes you own and build your personal grid.</p><button onClick={() => open({ view: "Connect" })}><Wallet size={18}/>CONNECT WALLET</button></div>;
}

ReactDOM.createRoot(document.getElementById("root")).render(<React.StrictMode><App/></React.StrictMode>);
