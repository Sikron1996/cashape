import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactDOM from "react-dom/client";
import { Contract, JsonRpcProvider } from "ethers";
import { ArrowLeft, Download, ExternalLink, Grid2X2, Search, Sparkles, Wallet, X } from "lucide-react";
import { useAppKit, useAppKitAccount } from "@reown/appkit/react";
import { NFT_ABI } from "./abi";
import { SITE_CONFIG } from "./config";
import "./appkit";
import "./styles.css";

const provider = new JsonRpcProvider(SITE_CONFIG.rpcUrl);
const contract = new Contract(SITE_CONFIG.contractAddress, NFT_ABI, provider);
const RARITY_CACHE_KEY = "cash-apes-rarity-v1";

const ROUTES = { collection: "/", my: "/my-apes", grid: "/grid-builder" };

function routeFromPath(path = window.location.pathname) {
  const p = path.replace(/\/+$/, "") || "/";
  const apeMatch = p.match(/^\/ape\/(\d+)$/);
  if (apeMatch) return { tab: "detail", tokenId: Number(apeMatch[1]) };
  if (p === "/my-apes") return { tab: "my", tokenId: null };
  if (p === "/grid-builder") return { tab: "grid", tokenId: null };
  return { tab: "collection", tokenId: null };
}

function shortAddress(address) { return address ? `${address.slice(0, 6)}...${address.slice(-4)}` : ""; }
function ipfsToHttp(uri = "") {
  if (!uri) return "";
  if (uri.startsWith("ipfs://ipfs/")) return `${SITE_CONFIG.ipfsGateway}${uri.slice(12)}`;
  if (uri.startsWith("ipfs://")) return `${SITE_CONFIG.ipfsGateway}${uri.slice(7)}`;
  return uri;
}
async function fetchJson(url) {
  const res = await fetch(url, { cache: "force-cache" });
  if (!res.ok) throw new Error(`Metadata ${res.status}`);
  return res.json();
}
function metadataCandidates(id) {
  return [`${SITE_CONFIG.metadataGatewayBase}${id}`, `${SITE_CONFIG.metadataGatewayBase}${id}.json`];
}
async function fetchMetadataById(id) {
  for (const url of metadataCandidates(id)) {
    try { return await fetchJson(url); } catch { /* try next */ }
  }
  throw new Error(`Metadata not found for #${id}`);
}
function traitKey(trait, value) { return `${String(trait || "").trim()}::${String(value ?? "").trim()}`; }
function rarityTier(rank) {
  if (!Number.isFinite(rank)) return "UNRANKED";
  if (rank <= 100) return "LEGENDARY";
  if (rank <= 500) return "EPIC";
  if (rank <= 1500) return "RARE";
  if (rank <= 4000) return "UNCOMMON";
  return "COMMON";
}
function parseExplicitRank(meta) {
  const candidates = [meta?.rarity_rank, meta?.rarityRank, meta?.rank, meta?.rarity?.rank];
  const attrs = Array.isArray(meta?.attributes) ? meta.attributes : [];
  for (const a of attrs) {
    if (/^(rarity\s*rank|rank)$/i.test(String(a?.trait_type || ""))) candidates.push(a?.value);
  }
  for (const value of candidates) {
    const n = Number(String(value ?? "").replace(/[^0-9.]/g, ""));
    if (Number.isFinite(n) && n > 0) return Math.floor(n);
  }
  return null;
}
async function getTokenData(tokenId, explorerItem = null, rarityIndex = null) {
  const explorerMeta = explorerItem?.metadata || null;
  const explorerImage = ipfsToHttp(explorerItem?.image_url || explorerMeta?.image || explorerMeta?.image_url || "");
  let meta = explorerMeta;
  let image = explorerImage;
  if (!meta && !image) {
    let metadataUrl = "";
    try { metadataUrl = ipfsToHttp(await contract.tokenURI(tokenId)); } catch { metadataUrl = `${SITE_CONFIG.metadataGatewayBase}${tokenId}`; }
    try { meta = await fetchJson(metadataUrl); }
    catch { try { meta = await fetchMetadataById(tokenId); } catch { /* fallback */ } }
    image = ipfsToHttp(meta?.image || meta?.image_url || "");
  }
  const cached = rarityIndex?.ranks?.[String(tokenId)] || null;
  const explicitRank = parseExplicitRank(meta);
  const rank = cached?.rank ?? explicitRank ?? null;
  return {
    id: Number(tokenId),
    name: meta?.name || `Cash Ape #${tokenId}`,
    description: meta?.description || "",
    image,
    attributes: Array.isArray(meta?.attributes) ? meta.attributes : [],
    rank,
    score: cached?.score ?? null,
    tier: rarityTier(rank)
  };
}

function TokenCard({ token, selected, onToggle, selectable = false, onOpen }) {
  const click = () => selectable ? onToggle?.(token) : onOpen?.(token);
  return (
    <article className={`ape-card ${selected ? "selected" : ""}`} onClick={click} role="button" tabIndex={0} onKeyDown={e => e.key === "Enter" && click()}>
      <div className="ape-image-wrap">
        {token.image ? <img src={token.image} alt={token.name} loading="lazy" /> : <div className="image-fallback">APE<br />#{token.id}</div>}
        {selectable && <div className="select-badge">{selected ? "SELECTED" : "SELECT"}</div>}
        {!selectable && Number.isFinite(token.rank) && <div className={`rarity-badge tier-${token.tier.toLowerCase()}`}>#{token.rank} {token.tier}</div>}
      </div>
      <div className="ape-meta"><strong>{token.name}</strong><span>#{token.id}</span></div>
    </article>
  );
}

async function loadOwnerTokensViaBlockscout(owner) {
  const found = []; let next = null;
  for (let page = 0; page < 100; page++) {
    const u = new URL(`${SITE_CONFIG.explorerBaseUrl}/api/v2/addresses/${owner}/nft`);
    u.searchParams.set("type", "ERC-721");
    if (next) Object.entries(next).forEach(([k, v]) => v != null && u.searchParams.set(k, String(v)));
    const res = await fetch(u.toString(), { cache: "no-store" });
    if (!res.ok) throw new Error(`Explorer NFT lookup failed (${res.status})`);
    const data = await res.json();
    for (const item of Array.isArray(data.items) ? data.items : []) {
      const tokenAddress = String(item?.token?.address_hash || item?.token?.address || item?.address_hash || item?.address || "").toLowerCase();
      if (tokenAddress !== SITE_CONFIG.contractAddress.toLowerCase()) continue;
      const rawId = item?.id ?? item?.token_id ?? item?.tokenId;
      if (rawId == null || !Number.isFinite(Number(rawId))) continue;
      found.push({ id: Number(rawId), item });
    }
    next = data?.next_page_params || null; if (!next) break;
  }
  const unique = new Map(); found.forEach(v => unique.set(v.id, v));
  return [...unique.values()].sort((a, b) => a.id - b.id);
}
async function loadOwnerTokensViaOwnerOf(owner, expectedBalance) {
  if (!expectedBalance) return [];
  const wanted = owner.toLowerCase(), ids = [], batchSize = 80;
  for (let start = 1; start <= SITE_CONFIG.supply && ids.length < expectedBalance; start += batchSize) {
    const end = Math.min(SITE_CONFIG.supply, start + batchSize - 1), checks = [];
    for (let id = start; id <= end; id++) checks.push(contract.ownerOf(id).then(v => String(v).toLowerCase() === wanted ? id : null).catch(() => null));
    ids.push(...(await Promise.all(checks)).filter(Boolean));
  }
  return ids;
}

function App() {
  const { open } = useAppKit();
  const { address, isConnected } = useAppKitAccount();
  const initial = routeFromPath();
  const [tab, setTab] = useState(initial.tab);
  const [detailId, setDetailId] = useState(initial.tokenId);
  const [detailToken, setDetailToken] = useState(null);
  const [detailBusy, setDetailBusy] = useState(false);
  const [minted, setMinted] = useState(SITE_CONFIG.supply);
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState("");
  const [rarityFilter, setRarityFilter] = useState("ALL");
  const [tokens, setTokens] = useState([]);
  const [collectionBusy, setCollectionBusy] = useState(false);
  const [rarityIndex, setRarityIndex] = useState(null);
  const [rarityBusy, setRarityBusy] = useState(false);
  const [rarityProgress, setRarityProgress] = useState(0);
  const [myTokens, setMyTokens] = useState([]);
  const [myBusy, setMyBusy] = useState(false);
  const [myStatus, setMyStatus] = useState("");
  const [selected, setSelected] = useState([]);
  const [gridSize, setGridSize] = useState(3);
  const [gridBusy, setGridBusy] = useState(false);
  const [gridText, setGridText] = useState("");
  const [showGridNumbers, setShowGridNumbers] = useState(true);
  const previewCanvasRef = useRef(null);

  useEffect(() => {
    try { const cached = JSON.parse(localStorage.getItem(RARITY_CACHE_KEY) || "null"); if (cached?.ranks && cached?.frequencies) setRarityIndex(cached); } catch { /* ignore */ }
  }, []);

  const navigate = useCallback((nextTab, tokenId = null) => {
    const path = nextTab === "detail" && tokenId ? `/ape/${tokenId}` : ROUTES[nextTab] || "/";
    if (window.location.pathname !== path) window.history.pushState({}, "", path);
    setTab(nextTab); setDetailId(tokenId); window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  useEffect(() => {
    const onPop = () => { const r = routeFromPath(); setTab(r.tab); setDetailId(r.tokenId); };
    window.addEventListener("popstate", onPop); return () => window.removeEventListener("popstate", onPop);
  }, []);
  useEffect(() => { contract.totalSupply().then(v => setMinted(Number(v))).catch(() => {}); }, []);

  const filteredIds = useMemo(() => {
    if (rarityFilter === "ALL" || !rarityIndex?.ranks) return null;
    return Object.entries(rarityIndex.ranks)
      .filter(([, info]) => rarityTier(Number(info.rank)) === rarityFilter)
      .sort((a, b) => Number(a[1].rank) - Number(b[1].rank))
      .map(([id]) => Number(id));
  }, [rarityFilter, rarityIndex]);

  const collectionCount = filteredIds ? filteredIds.length : Math.max(minted, SITE_CONFIG.supply);
  const maxPage = Math.max(1, Math.ceil(collectionCount / SITE_CONFIG.pageSize));

  const loadCollectionPage = useCallback(async () => {
    if (tab !== "collection") return;
    setCollectionBusy(true);
    try {
      const q = query.trim(); let ids;
      if (/^\d+$/.test(q)) {
        const id = Number(q); ids = id >= 1 && id <= SITE_CONFIG.supply ? [id] : [];
      } else if (filteredIds) {
        const first = (page - 1) * SITE_CONFIG.pageSize;
        ids = filteredIds.slice(first, first + SITE_CONFIG.pageSize);
      } else {
        const first = (page - 1) * SITE_CONFIG.pageSize + 1;
        const last = Math.min(first + SITE_CONFIG.pageSize - 1, Math.max(minted, SITE_CONFIG.supply));
        ids = Array.from({ length: Math.max(0, last - first + 1) }, (_, i) => first + i);
      }
      setTokens(await Promise.all(ids.map(id => getTokenData(id, null, rarityIndex))));
    } finally { setCollectionBusy(false); }
  }, [page, query, minted, tab, filteredIds, rarityIndex]);
  useEffect(() => { loadCollectionPage(); }, [loadCollectionPage]);

  useEffect(() => {
    if (tab !== "detail" || !detailId) return;
    setDetailBusy(true); setDetailToken(null);
    getTokenData(detailId, null, rarityIndex).then(setDetailToken).finally(() => setDetailBusy(false));
  }, [tab, detailId, rarityIndex]);

  async function buildRarityIndex() {
    if (rarityBusy) return;
    setRarityBusy(true); setRarityProgress(0);
    try {
      const metas = new Array(SITE_CONFIG.supply + 1);
      const concurrency = 24;
      let cursor = 1;
      async function worker() {
        while (true) {
          const id = cursor++; if (id > SITE_CONFIG.supply) return;
          try { metas[id] = await fetchMetadataById(id); } catch { metas[id] = null; }
          if (id % 20 === 0 || id === SITE_CONFIG.supply) setRarityProgress(Math.min(100, Math.round((id / SITE_CONFIG.supply) * 100)));
        }
      }
      await Promise.all(Array.from({ length: concurrency }, worker));
      const frequencies = {};
      for (let id = 1; id <= SITE_CONFIG.supply; id++) {
        const attrs = Array.isArray(metas[id]?.attributes) ? metas[id].attributes : [];
        for (const a of attrs) {
          const key = traitKey(a?.trait_type, a?.value); if (!key.startsWith("::")) frequencies[key] = (frequencies[key] || 0) + 1;
        }
      }
      const scored = [];
      for (let id = 1; id <= SITE_CONFIG.supply; id++) {
        const meta = metas[id]; if (!meta) continue;
        const explicit = parseExplicitRank(meta);
        const attrs = Array.isArray(meta?.attributes) ? meta.attributes : [];
        let score = 0;
        for (const a of attrs) { const count = frequencies[traitKey(a?.trait_type, a?.value)] || SITE_CONFIG.supply; score += SITE_CONFIG.supply / count; }
        scored.push({ id, score, explicit });
      }
      scored.sort((a, b) => {
        if (a.explicit && b.explicit) return a.explicit - b.explicit;
        if (a.explicit) return -1; if (b.explicit) return 1;
        return b.score - a.score || a.id - b.id;
      });
      const ranks = {};
      scored.forEach((x, i) => { ranks[String(x.id)] = { rank: x.explicit || i + 1, score: Number(x.score.toFixed(4)) }; });
      const next = { version: 1, builtAt: Date.now(), ranks, frequencies };
      setRarityIndex(next); localStorage.setItem(RARITY_CACHE_KEY, JSON.stringify(next)); setRarityProgress(100);
    } catch (e) { console.error(e); alert("Could not build the rarity index. Please try again."); }
    finally { setRarityBusy(false); }
  }

  const loadMyApes = useCallback(async () => {
    if (!address) return;
    setMyBusy(true); setMyStatus("Finding your Cash Apes…");
    try {
      const expectedBalance = Number(await contract.balanceOf(address).catch(() => 0));
      if (expectedBalance === 0) { setMyTokens([]); setMyStatus("No Cash Apes found in this wallet."); return; }
      let rows = []; try { rows = await loadOwnerTokensViaBlockscout(address); } catch (e) { console.warn("Blockscout lookup failed", e); }
      let ids = rows.map(r => r.id);
      if (ids.length !== expectedBalance) { setMyStatus(`Explorer found ${ids.length}/${expectedBalance}. Checking on-chain…`); ids = await loadOwnerTokensViaOwnerOf(address, expectedBalance); rows = ids.map(id => ({ id, item: null })); }
      const data = [];
      for (let start = 0; start < rows.length; start += 16) data.push(...await Promise.all(rows.slice(start, start + 16).map(r => getTokenData(r.id, r.item, rarityIndex))));
      setMyTokens(data); setMyStatus(`${data.length} Cash Ape${data.length === 1 ? "" : "s"} found.`);
    } catch (e) { console.error(e); setMyTokens([]); setMyStatus("Could not load wallet NFTs. Press Refresh to try again."); }
    finally { setMyBusy(false); }
  }, [address, rarityIndex]);
  useEffect(() => { if (isConnected && (tab === "my" || tab === "grid")) loadMyApes(); }, [isConnected, tab, loadMyApes]);

  function toggleSelected(token) { setSelected(current => current.some(t => t.id === token.id) ? current.filter(t => t.id !== token.id) : current.length >= 100 ? current : [...current, token]); }
  const selectedIds = useMemo(() => new Set(selected.map(t => t.id)), [selected]);
  async function imageToObjectUrl(url) { const r = await fetch(url); if (!r.ok) throw new Error("Image fetch failed"); return URL.createObjectURL(await r.blob()); }
  async function drawGrid(canvas, forDownload = false) {
    if (!canvas || !selected.length) return;
    const cols = Math.max(1, Math.min(gridSize, selected.length)), rows = Math.ceil(selected.length / cols);
    const targetMax = forDownload ? 4800 : 2600;
    const baseCell = forDownload ? 620 : 300;
    const cell = Math.max(forDownload ? 260 : 150, Math.min(baseCell, Math.floor(targetMax / cols)));
    const header = Math.max(forDownload ? 220 : 105, Math.round(cell * (forDownload ? .48 : .42)));
    const footer = Math.max(forDownload ? 82 : 42, Math.round(cell * .18));
    canvas.width = cols * cell; canvas.height = header + rows * cell + footer;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#050505"; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.textAlign = "center"; ctx.fillStyle = "#c8ff00"; ctx.font = `900 ${Math.min(forDownload ? 140 : 58, canvas.width / 7)}px Arial Black, Arial`;
    ctx.fillText("CASH APES", canvas.width / 2, Math.round(header * .40));
    const custom = gridText.trim();
    ctx.fillStyle = "#fff"; ctx.font = `700 ${Math.min(forDownload ? 52 : 22, canvas.width / 18)}px Arial`;
    ctx.fillText(custom || `${selected.length} APES • ROBINHOOD CHAIN`, canvas.width / 2, Math.round(header * .69), canvas.width - 40);
    ctx.fillStyle = "#777"; ctx.font = `700 ${Math.min(forDownload ? 28 : 12, canvas.width / 30)}px Arial`;
    ctx.fillText(`${selected.length} APES • ROBINHOOD CHAIN`, canvas.width / 2, Math.round(header * .88));
    const objectUrls = [];
    try {
      for (let i = 0; i < selected.length; i++) {
        const token = selected[i], x = (i % cols) * cell, y = header + Math.floor(i / cols) * cell;
        ctx.fillStyle = "#111"; ctx.fillRect(x + 4, y + 4, cell - 8, cell - 8);
        if (token.image) {
          const objectUrl = await imageToObjectUrl(token.image); objectUrls.push(objectUrl);
          const img = new Image(); await new Promise((resolve, reject) => { img.onload = resolve; img.onerror = reject; img.src = objectUrl; });
          const scale = Math.max(cell / img.width, cell / img.height), w = img.width * scale, h = img.height * scale;
          ctx.save(); ctx.beginPath(); ctx.rect(x + 5, y + 5, cell - 10, cell - 10); ctx.clip(); ctx.drawImage(img, x + (cell - w) / 2, y + (cell - h) / 2, w, h); ctx.restore();
        }
        if (showGridNumbers) {
          const labelH = Math.max(20, Math.round(cell * .075));
          const labelW = Math.max(70, Math.round(cell * .25));
          ctx.fillStyle = "rgba(0,0,0,.72)"; ctx.fillRect(x + Math.round(cell*.018), y + cell - labelH - Math.round(cell*.018), labelW, labelH);
          ctx.fillStyle = "#c8ff00"; ctx.textAlign = "left"; ctx.font = `800 ${Math.max(11, Math.round(cell*.036))}px Arial`; ctx.fillText(`#${token.id}`, x + Math.round(cell*.035), y + cell - Math.round(cell*.04));
        }
      }
      ctx.textAlign = "center"; ctx.fillStyle = "#777"; ctx.font = `700 ${forDownload ? 28 : 12}px Arial`; ctx.fillText("CASH APES • COMMUNITY GRID", canvas.width / 2, canvas.height - (forDownload ? 46 : 22));
    } finally { objectUrls.forEach(URL.revokeObjectURL); }
  }
  useEffect(() => {
    if (tab !== "grid" || !selected.length) return;
    let cancelled = false;
    (async () => { try { if (!cancelled) await drawGrid(previewCanvasRef.current, false); } catch (e) { console.error(e); } })();
    return () => { cancelled = true; };
  }, [tab, selected, gridSize, gridText, showGridNumbers]);
  async function createGrid() {
    if (!selected.length) return; setGridBusy(true);
    try {
      const canvas = document.createElement("canvas"); await drawGrid(canvas, true);
      const a = document.createElement("a"); a.download = `cash-apes-grid-${selected.length}.png`; a.href = canvas.toDataURL("image/png"); a.click();
    } catch (e) { console.error(e); alert("Grid export was blocked by the image gateway. Try again in a moment."); }
    finally { setGridBusy(false); }
  }

  const openToken = token => navigate("detail", token.id);

  return (
    <main>
      <header className="topbar">
        <button className="brand" onClick={() => navigate("collection")}>CASH APES</button>
        <nav>
          <button onClick={() => navigate("collection")} className={tab === "collection" || tab === "detail" ? "active" : ""}>COLLECTION</button>
          <button onClick={() => navigate("my")} className={tab === "my" ? "active" : ""}>MY APES</button>
          <button onClick={() => navigate("grid")} className={tab === "grid" ? "active" : ""}>GRID BUILDER</button>
          <a href={SITE_CONFIG.openSeaUrl} target="_blank" rel="noreferrer">OPENSEA <ExternalLink size={13}/></a>
          <a href={SITE_CONFIG.xUrl} target="_blank" rel="noreferrer">X <X size={14}/></a>
        </nav>
        <button className="wallet-button" onClick={() => open({ view: isConnected ? "Account" : "Connect" })}><Wallet size={16}/>{isConnected ? shortAddress(address) : "CONNECT"}</button>
      </header>

      {tab === "collection" && <>
        <section className="hero compact-hero">
          <img src="/cash-apes-banner.jpeg" alt="Cash Apes" /><div className="hero-shade" />
          <div className="hero-copy"><div className="chain-pill">ROBINHOOD CHAIN</div><h1>CASH APES</h1><p>10,000 unique apes. Straight out of the jungle.</p></div>
          <div className="hero-stats"><div><span>SUPPLY</span><strong>10,000</strong></div><div><span>MINTED</span><strong>{minted.toLocaleString()}</strong></div><div><span>STATUS</span><strong className="lime">SOLD OUT</strong></div></div>
        </section>
        <section className="workspace compact-workspace">
          <div className="section-head collection-head"><div><span className="kicker">THE JUNGLE</span><h2>Collection</h2></div>
            <div className="collection-tools">
              <label className="search"><Search size={17}/><input value={query} onChange={e => { setQuery(e.target.value); setPage(1); }} placeholder="Search token ID" /></label>
              <label className="rarity-select"><Sparkles size={16}/><select value={rarityFilter} onChange={e => { setRarityFilter(e.target.value); setPage(1); }} disabled={!rarityIndex}><option>ALL</option><option>LEGENDARY</option><option>EPIC</option><option>RARE</option><option>UNCOMMON</option><option>COMMON</option></select></label>
            </div>
          </div>
          {!rarityIndex && <div className="rarity-setup"><div><strong>RARITY SEARCH</strong><span>Build the exact trait-frequency index once. It is saved in this browser.</span></div><button onClick={buildRarityIndex} disabled={rarityBusy}>{rarityBusy ? `CALCULATING ${rarityProgress}%` : "CALCULATE RARITY"}</button>{rarityBusy && <div className="rarity-progress"><i style={{width:`${rarityProgress}%`}} /></div>}</div>}
          {rarityIndex && <div className="rarity-ready"><Sparkles size={14}/> Rarity index ready • click any Ape for full details</div>}
          {collectionBusy ? <div className="loading">LOADING APES…</div> : <div className="nft-grid">{tokens.map(t => <TokenCard key={t.id} token={t} onOpen={openToken}/>)}</div>}
          {!query && <div className="pager"><button disabled={page <= 1} onClick={() => setPage(p => p - 1)}>← PREV</button><span>{page} / {maxPage}</span><button disabled={page >= maxPage} onClick={() => setPage(p => p + 1)}>NEXT →</button></div>}
        </section>
      </>}

      {tab === "detail" && <section className="workspace route-workspace detail-workspace">
        <button className="back-button" onClick={() => navigate("collection")}><ArrowLeft size={16}/> BACK TO COLLECTION</button>
        {detailBusy ? <div className="loading">LOADING APE…</div> : detailToken ? <div className="ape-detail">
          <div className="detail-art">{detailToken.image ? <img src={detailToken.image} alt={detailToken.name}/> : <div className="image-fallback">APE #{detailToken.id}</div>}</div>
          <div className="detail-info"><span className="kicker">CASH APES • #{detailToken.id}</span><h1>{detailToken.name}</h1>
            <div className="detail-rarity"><div><span>RARITY RANK</span><strong>{Number.isFinite(detailToken.rank) ? `#${detailToken.rank}` : "—"}</strong></div><div><span>TIER</span><strong className="lime">{detailToken.tier}</strong></div><div><span>TRAITS</span><strong>{detailToken.attributes.length}</strong></div></div>
            {detailToken.description && <p className="detail-description">{detailToken.description}</p>}
            <h3>TRAITS</h3><div className="traits-grid">{detailToken.attributes.length ? detailToken.attributes.map((a,i) => { const count = rarityIndex?.frequencies?.[traitKey(a?.trait_type,a?.value)]; const pct = count ? ((count / SITE_CONFIG.supply) * 100).toFixed(count / SITE_CONFIG.supply < .01 ? 2 : 1) : null; return <div className="trait" key={`${a?.trait_type}-${i}`}><span>{a?.trait_type || "TRAIT"}</span><strong>{String(a?.value ?? "—")}</strong>{count && <em>{count.toLocaleString()} • {pct}%</em>}</div>; }) : <div className="empty-traits">No traits in metadata.</div>}</div>
            <div className="detail-actions"><a href={`https://opensea.io/item/robinhood/${SITE_CONFIG.contractAddress.toLowerCase()}/${detailToken.id}`} target="_blank" rel="noreferrer">VIEW ON OPENSEA <ExternalLink size={14}/></a><a href={`${SITE_CONFIG.explorerBaseUrl}/token/${SITE_CONFIG.contractAddress}/instance/${detailToken.id}`} target="_blank" rel="noreferrer">BLOCKSCOUT <ExternalLink size={14}/></a></div>
          </div>
        </div> : <div className="empty">Could not load this Cash Ape.</div>}
      </section>}

      {tab === "my" && <section className="workspace route-workspace">
        <div className="section-head"><div><span className="kicker">YOUR WALLET</span><h2>My Apes</h2><p>Your Cash Apes, loaded directly from your connected wallet.</p></div></div>
        {!isConnected ? <ConnectPanel open={open}/> : <><div className="wallet-summary"><span>{shortAddress(address)}</span><strong>{myStatus || "Ready"}</strong><button onClick={loadMyApes} disabled={myBusy}>{myBusy ? "LOADING…" : "REFRESH"}</button></div>{myBusy && !myTokens.length ? <div className="loading">FINDING YOUR APES…</div> : myTokens.length ? <div className="nft-grid">{myTokens.map(t => <TokenCard key={t.id} token={t} onOpen={openToken}/>)}</div> : <div className="empty">{myStatus || "No Cash Apes loaded."}</div>}</>}
      </section>}

      {tab === "grid" && <section className="workspace route-workspace">
        <div className="section-head"><div><span className="kicker">MAKE IT YOURS</span><h2>Grid Builder</h2><p>Select up to 100 Cash Apes, preview the grid live, add your own text and download it.</p></div></div>
        {!isConnected ? <ConnectPanel open={open}/> : <>
          <div className="builder-bar">
            <div><span>SELECTED</span><strong>{selected.length} / 100</strong></div>
            <div className="grid-size"><span>COLUMNS</span>{[2,3,4,5,6,8,10].map(n => <button key={n} className={gridSize === n ? "active" : ""} onClick={() => setGridSize(n)}>{n}</button>)}</div>
            <button className="builder-action" onClick={() => setSelected(myTokens.slice(0,100))} disabled={!myTokens.length}>SELECT UP TO 100</button>
            <button className="builder-action" onClick={() => setSelected([])} disabled={!selected.length}>CLEAR</button>
            <button className="download" disabled={!selected.length || gridBusy} onClick={createGrid}><Download size={17}/>{gridBusy ? "BUILDING…" : "DOWNLOAD PNG"}</button>
          </div>
          <div className="grid-builder-layout">
            <div className="grid-picker">
              <div className="grid-picker-title"><span>YOUR APES</span><strong>CLICK TO SELECT</strong></div>
              {myBusy && !myTokens.length && <div className="loading">FINDING YOUR APES…</div>}
              {!myBusy && !myTokens.length && <div className="empty">{myStatus || "No Cash Apes loaded."}</div>}
              <div className="nft-grid grid-picker-grid">{myTokens.map(t => <TokenCard key={t.id} token={t} selectable selected={selectedIds.has(t.id)} onToggle={toggleSelected}/>)}</div>
            </div>
            <aside className="grid-preview-panel">
              <div className="grid-preview-head"><div><span>LIVE PREVIEW</span><strong>CASH APES is always included</strong></div></div>
              <div className="grid-text-box"><label>CUSTOM TEXT <small>optional</small></label><input maxLength={48} value={gridText} onChange={e => setGridText(e.target.value)} placeholder="e.g. JUNGLE CREW 🦍"/><em>{gridText.length}/48</em></div>
              <label className="number-toggle"><input type="checkbox" checked={showGridNumbers} onChange={e => setShowGridNumbers(e.target.checked)}/><span>SHOW NFT NUMBERS</span><strong>{showGridNumbers ? "ON" : "OFF"}</strong></label>
              {selected.length ? <div className="grid-canvas-wrap"><canvas ref={previewCanvasRef}/></div> : <div className="grid-preview-empty">SELECT APES TO PREVIEW YOUR GRID</div>}
              <button className="download preview-download" disabled={!selected.length || gridBusy} onClick={createGrid}><Download size={17}/>{gridBusy ? "BUILDING…" : "DOWNLOAD PNG"}</button>
            </aside>
          </div>
        </>}
      </section>}

      <footer><span>CASH APES • #BAYC 2.0 • ROBINHOOD CHAIN</span><div className="footer-links"><a href={SITE_CONFIG.openSeaUrl} target="_blank" rel="noreferrer">OPENSEA <ExternalLink size={12}/></a><a href={SITE_CONFIG.xUrl} target="_blank" rel="noreferrer">X <X size={12}/></a><a href={`${SITE_CONFIG.explorerBaseUrl}/address/${SITE_CONFIG.contractAddress}`} target="_blank" rel="noreferrer">CONTRACT <ExternalLink size={12}/></a></div></footer>
    </main>
  );
}
function ConnectPanel({ open }) { return <div className="connect-panel"><Grid2X2 size={34}/><h3>Connect your wallet</h3><p>Connect to see the Cash Apes you own and build your personal grid.</p><button onClick={() => open({ view: "Connect" })}><Wallet size={17}/>CONNECT WALLET</button></div>; }
ReactDOM.createRoot(document.getElementById("root")).render(<React.StrictMode><App/></React.StrictMode>);
