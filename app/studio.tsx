"use client";
import { useEffect, useState } from "react";
import { AudioLines, Mic2, Library, Settings2, ArrowUpRight, ArrowRight, Download, Check, Search, PlugZap, LoaderCircle, ShieldCheck, Sparkles, ChevronLeft, ChevronRight } from "lucide-react";
type Tab = "studio" | "voices" | "history" | "settings";
type Config = { configured: boolean; default_voice: string; model: string; settings_url: string; max_characters: number };
type Voice = { id: string; title: string; description: string; languages: string[]; voice_url: string };
type Clip = { id: string; title: string; text: string; status: string; model: string; speed: number; bytes: number | null; error: string | null; audio_url: string | null; download_url: string | null; created_at: string };
const tabs = [{ id: "studio", label: "Studio", icon: AudioLines }, { id: "voices", label: "Les voix", icon: Mic2 }, { id: "history", label: "Mes audios", icon: Library }, { id: "settings", label: "Réglages", icon: Settings2 }] as const;
async function api<T>(action: string, data?: unknown, query = ""): Promise<T> {
  const response = await fetch(data === undefined ? `/api/studio?action=${action}${query}` : "/api/studio", data === undefined ? { cache: "no-store" } : {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, data }),
  });
  if (!response.headers.get("content-type")?.includes("application/json")) throw new Error("Ta session a expiré. Recharge la page pour te reconnecter.");
  const json = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(json.error ?? "Une erreur est survenue.");
  return json;
}
export default function Studio({ displayName }: { displayName: string }) {
  const [tab, setTab] = useState<Tab>("studio");
  const [config, setConfig] = useState<Config | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [script, setScript] = useState("");
  const [voiceId, setVoiceId] = useState("");
  const [speed, setSpeed] = useState(1);
  const [result, setResult] = useState<Clip | null>(null);
  const [history, setHistory] = useState<Clip[]>([]);
  const [voices, setVoices] = useState<Voice[]>([]);
  const [query, setQuery] = useState("");
  const [language, setLanguage] = useState("fr");
  const [own, setOwn] = useState(false);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [searched, setSearched] = useState(false);
  const [key, setKey] = useState("");
  const [defaultVoice, setDefaultVoice] = useState("");
  const [model, setModel] = useState("s2.1-pro-free");
  const clear = () => { setError(""); setMessage(""); };
  async function reloadHistory() {
    const data = await api<{ voiceovers: Clip[] }>("history"); setHistory(data.voiceovers);
  }
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("tab") === "settings") setTab("settings");
    Promise.all([api<Config>("status"), api<{ voiceovers: Clip[] }>("history")]).then(([status, clips]) => {
      setConfig(status); setModel(status.model); setDefaultVoice(status.default_voice); setVoiceId(status.default_voice); setHistory(clips.voiceovers);
    }).catch(e => setError(e.message));
  }, []);
  async function save(voice = defaultVoice) {
    clear(); setBusy("settings");
    try {
      const data = await api<Config>("settings", { ...(key.trim() ? { api_key: key.trim() } : {}), default_voice: voice.trim(), model });
      setConfig(data); setKey(""); setDefaultVoice(data.default_voice); setVoiceId(data.default_voice); setMessage("Réglages enregistrés.");
    } catch (e) { setError(e instanceof Error ? e.message : "Enregistrement impossible."); }
    finally { setBusy(null); }
  }
  async function generate() {
    clear(); setBusy("generate"); setResult(null);
    try {
      const clip = await api<Clip>("generate", { text: script.trim(), title: title.trim() || "Ma voix off", ...(voiceId.trim() ? { voice_id: voiceId.trim() } : {}), speed, request_id: crypto.randomUUID() });
      setResult(clip); await reloadHistory();
      if (clip.status === "ready") setMessage("Ton audio est prêt.");
      else setError(clip.error || "La génération est en cours. Consulte Mes audios avant de relancer.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Génération impossible.");
      await reloadHistory().catch(() => {});
    } finally { setBusy(null); }
  }
  async function search(targetPage = 1) {
    clear(); setBusy("search");
    try {
      const params = new URLSearchParams({ query, language, own: String(own), page: String(targetPage) });
      const data = await api<{ voices: Voice[]; has_more: boolean }>("voices", undefined, `&${params}`);
      setVoices(data.voices); setPage(targetPage); setHasMore(data.has_more); setSearched(true);
    } catch (e) { setError(e instanceof Error ? e.message : "Recherche impossible."); }
    finally { setBusy(null); }
  }
  async function removeKey() {
    clear(); setBusy("disconnect");
    try { setConfig(await api<Config>("disconnect", {})); setKey(""); setMessage("La clé Fish Audio a été retirée."); }
    catch (e) { setError(e instanceof Error ? e.message : "Impossible de retirer la clé."); }
    finally { setBusy(null); }
  }
  const connected = !!config?.configured;
  return <div className="app-shell">
    <aside className="sidebar">
      <a className="brand" href="/" aria-label="Fish Audio, accueil"><span className="brand-mark"><img src="/fish-audio-icon.png" width={40} height={40} alt="" /></span><span>Fish <span className="brand-light">Audio</span><small>STUDIO DE VOIX OFF</small></span></a>
      <nav aria-label="Navigation principale">{tabs.map(item => <button key={item.id} className={tab === item.id ? "nav-item active" : "nav-item"} onClick={() => { setTab(item.id); clear(); }} aria-current={tab === item.id ? "page" : undefined}><item.icon size={19} />{item.label}{item.id === "studio" && <span className="nav-dot" />}</button>)}</nav>
      <div className="sidebar-bottom"><span className="private-label"><ShieldCheck size={15} /> Espace privé</span><p>De l’idée à la voix.<br />Sans quitter ton flow.</p><div className="profile"><span className="avatar">{displayName.charAt(0).toUpperCase()}</span><span className="profile-name">{displayName}</span></div></div>
    </aside>
    <div className="workspace">
      <header className="topbar"><span>ESPACE CRÉATEUR <span className="breadcrumb">/ {tabs.find(x => x.id === tab)?.label}</span></span><button className={connected ? "connection connected" : "connection"} onClick={() => setTab("settings")}><span className="status-dot" />{config ? connected ? "Fish Audio connecté" : "Connecter Fish Audio" : "Chargement…"}<ArrowUpRight size={14} /></button></header>
      <main className="content">
        {error && <div className="notice error" role="alert">{error}<button onClick={() => setError("")} aria-label="Fermer le message">×</button></div>}
        {message && <div className="notice success" role="status"><Check size={17} />{message}</div>}
        {tab === "studio" && <>
          <section className="hero"><div><span className="eyebrow"><Sparkles size={14} /> FAIS ENTENDRE TES IDÉES</span><h1>Tes mots.<br /><span>Une voix qui marque.</span></h1><p>Une vidéo, une démo, une idée à raconter.<br />Écris ton texte. On s’occupe de la voix.</p></div><div className="sound-art" aria-hidden="true"><div className="sound-orbit" /><div className="sound-bars">{Array.from({ length: 35 }, (_, i) => <i key={i} style={{ height: `${18 + Math.abs(Math.sin(i * 1.63)) * (90 - Math.abs(i - 17) * 3.2)}px` }} />)}</div><span>MAKE IT HEARD.</span></div></section>
          {!connected && config && <div className="connect-banner"><PlugZap size={25} /><div><strong>Une connexion, et c’est parti.</strong><p>Ajoute ta clé API Fish Audio pour créer ta première voix off.</p></div><button onClick={() => setTab("settings")}>Configurer <ArrowRight size={16} /></button></div>}
          <div className="studio-grid"><section className="panel script-panel"><div className="panel-heading"><div><span className="step">01</span><h2>Le texte à faire vivre</h2></div><span className="soft-badge">MP3 · 192 kbps</span></div><label className="field">Titre du projet<input value={title} onChange={e => setTitle(e.target.value)} maxLength={100} placeholder="Ex. Présentation d’un produit" /></label><label className="field script-field">Ton script<textarea value={script} onChange={e => setScript(e.target.value)} maxLength={1500} placeholder="Colle ici le texte de ta voix off…" rows={10} /><span className="script-footer"><span>Le texte est prononcé tel quel.</span><span>{script.length} / 1 500</span></span></label><button className="example" onClick={() => { setTitle("Bienvenue — démonstration"); setScript("Chaque idée mérite d’être entendue. Une histoire, une vidéo, une présentation : choisis la voix qui lui ressemble et donne vie à tes mots."); }}>Essayer avec un exemple <ArrowUpRight size={13} /></button></section>
          <aside className="panel voice-panel"><div className="panel-heading"><div><span className="step">02</span><h2>La touche finale</h2></div></div><div className="voice-preview"><span className="voice-circle"><Mic2 size={30} /></span><strong>{voiceId ? "Ta voix sélectionnée" : "Trouve ta voix"}</strong><span>{voiceId ? `${voiceId.slice(0, 12)}…` : "Narration, énergie, naturel…"}</span><button className="text-button" onClick={() => setTab("voices")}>Explorer les voix <ArrowRight size={15} /></button></div><label className="field">ID de la voix<input value={voiceId} onChange={e => setVoiceId(e.target.value)} placeholder="Identifiant Fish Audio" maxLength={80} /></label><label className="field speed-field"><span>Vitesse <strong>{speed.toFixed(2)}×</strong></span><input type="range" min="0.5" max="2" step="0.05" value={speed} onChange={e => setSpeed(Number(e.target.value))} /><span className="range-labels"><span>Posée</span><span>Dynamique</span></span></label><div className="model-label">{model === "s2.1-pro-free" ? "S2.1 Pro · offre développeur" : "S2.1 Pro · API payante"}</div><button className="primary generate-button" disabled={!!busy || !connected || !script.trim() || !voiceId.trim()} onClick={generate}>{busy === "generate" ? <LoaderCircle className="spin" size={19} /> : <AudioLines size={19} />}{busy === "generate" ? "La voix prend forme…" : "Générer ma voix off"}</button><p className="button-note">Avec ton compte et le modèle choisi dans les réglages.</p></aside></div>
          {result?.status === "ready" && <section className="panel result-panel"><span className="result-check"><Check size={23} /></span><div><h2>{result.title}</h2><p>Ton MP3 est prêt à rejoindre ta vidéo.</p></div><audio controls preload="metadata" src={result.audio_url!} /><a className="secondary" href={result.download_url!}><Download size={17} />Télécharger</a></section>}
          <section className="chat-hint"><span className="chat-icon"><PlugZap size={21} /></span><div><strong>Aussi, directement dans ChatGPT.</strong><p>Après installation du plugin, demande : « Choisis une voix française naturelle et génère une voix off avec ce texte… »</p></div><span className="soft-badge">FISH AUDIO</span></section>
        </>}
        {tab === "voices" && <><div className="page-heading"><span className="eyebrow">LE BON TIMBRE, LE BON TON</span><h1>Trouve ta voix.</h1><p>Recherche dans le catalogue Fish Audio ou retrouve les voix de ton compte.</p></div><section className="panel"><form className="voice-search" onSubmit={e => { e.preventDefault(); search(); }}><label className="search-box"><Search size={18} /><input aria-label="Rechercher une voix par titre" value={query} onChange={e => setQuery(e.target.value)} placeholder="Rechercher par nom…" maxLength={100} /></label><select aria-label="Langue" value={language} disabled={own} onChange={e => setLanguage(e.target.value)}><option value="fr">Français</option><option value="en">Anglais</option><option value="es">Espagnol</option><option value="pt">Portugais</option><option value="zh">Chinois</option></select><label className="checkbox"><input type="checkbox" checked={own} onChange={e => setOwn(e.target.checked)} />Mes voix</label><button className="primary" disabled={!!busy || !connected}>{busy === "search" ? <LoaderCircle className="spin" size={18} /> : <Search size={18} />}Rechercher</button></form>{!connected && <p className="empty-caption">Connecte Fish Audio dans les réglages pour accéder aux voix.</p>}</section>
          {voices.length > 0 ? <><div className="voice-grid">{voices.map(voice => <article className="panel voice-card" key={voice.id}><div className="voice-card-top"><span className="small-voice-icon"><Mic2 size={23} /></span><a href={voice.voice_url} target="_blank" rel="noreferrer" aria-label={`Écouter ${voice.title} sur Fish Audio`}><ArrowUpRight size={19} /></a></div><h2>{voice.title}</h2><p>{voice.description || "Une voix du catalogue Fish Audio."}</p><span className="language-badge">{voice.languages?.join(" · ") || "Voix personnalisée"}</span><div className="voice-actions"><button className="secondary" onClick={() => { setVoiceId(voice.id); setTab("studio"); clear(); setMessage(`Voix sélectionnée : ${voice.title}`); }}>Utiliser <ArrowRight size={15} /></button><button className="text-button" disabled={!!busy} onClick={() => save(voice.id)}>Par défaut</button></div></article>)}</div><div className="pagination"><button className="secondary" disabled={page === 1 || !!busy} onClick={() => search(page - 1)}><ChevronLeft size={17} />Précédent</button><span>Page {page}</span><button className="secondary" disabled={!hasMore || !!busy} onClick={() => search(page + 1)}>Suivant<ChevronRight size={17} /></button></div></> : <div className="empty-state"><Mic2 size={42} /><h2>{searched ? "Aucune voix trouvée" : "Ta prochaine voix est ici"}</h2><p>{searched ? "Essaie un autre nom, une autre langue ou tes voix privées." : "Lance une recherche pour choisir une voix. Tu peux aussi saisir directement son identifiant dans le studio."}</p></div>}
        </>}
        {tab === "history" && <><div className="page-heading"><span className="eyebrow">PRÊTS POUR LE MONTAGE</span><h1>Mes audios.</h1><p>Tes voix off, conservées dans ton espace privé.</p><button className="secondary" onClick={() => { clear(); reloadHistory().catch(e => setError(e.message)); }}>Actualiser</button></div>{history.length ? <div className="history-list">{history.map(clip => <article key={clip.id} className="panel history-card"><div className="history-info"><span className="small-voice-icon"><AudioLines size={24} /></span><div><h2>{clip.title}</h2><p>{new Date(clip.created_at).toLocaleDateString("fr-FR")} · {clip.speed}× {clip.bytes ? `· ${(clip.bytes / 1024 / 1024).toFixed(1)} Mo` : ""}</p></div><span className={`clip-status ${clip.status}`}>{clip.status === "ready" ? "Prêt" : clip.status === "generating" ? "En cours" : "À vérifier"}</span></div><p className="clip-script">{clip.text}</p>{clip.status === "ready" ? <div className="history-audio"><audio controls preload="none" src={clip.audio_url!} /><a className="secondary" href={clip.download_url!}><Download size={16} />MP3</a></div> : <p className="clip-error">{clip.error || "Génération en cours. Actualise avant de relancer."}</p>}</article>)}</div> : <div className="empty-state"><Library size={42} /><h2>Le début de ta collection</h2><p>Ta première voix off apparaîtra ici dès qu’elle sera générée.</p><button className="primary" onClick={() => setTab("studio")}>Créer une voix off <ArrowRight size={16} /></button></div>}</>}
        {tab === "settings" && <><div className="page-heading"><span className="eyebrow">BRANCHE TON STUDIO</span><h1>Réglages.</h1><p>Ton compte Fish Audio. Tes voix. Ton espace.</p></div><div className="settings-grid"><section className="panel settings-panel"><div className="panel-heading"><h2>Connexion Fish Audio</h2><span className={connected ? "soft-badge mint" : "soft-badge"}>{connected ? "Connecté" : "À configurer"}</span></div><form onSubmit={e => { e.preventDefault(); save(); }}><label className="field">Clé API Fish Audio<input type="password" autoComplete="off" spellCheck={false} value={key} onChange={e => setKey(e.target.value)} placeholder={connected ? "Laisse vide pour conserver la clé actuelle" : "Colle ta clé API ici"} maxLength={512} required={!connected} /></label><p className="field-help"><ShieldCheck size={14} />Ta clé est conservée chiffrée. Elle n’est jamais renvoyée à ChatGPT.</p><label className="field">Voix par défaut<input value={defaultVoice} onChange={e => setDefaultVoice(e.target.value)} placeholder="ID de ta voix favorite (facultatif)" maxLength={80} /></label><label className="field">Modèle Fish Audio<select value={model} onChange={e => setModel(e.target.value)}><option value="s2.1-pro-free">S2.1 Pro — offre développeur gratuite</option><option value="s2.1-pro">S2.1 Pro — API payante</option></select></label><p className="field-help">Les limites de ton compte Fish Audio s’appliquent. Le modèle payant utilise ton solde API.</p><button className="primary" disabled={!!busy || !config}>{busy === "settings" ? <LoaderCircle className="spin" size={17} /> : <Check size={17} />}Enregistrer les réglages</button></form>{connected && <button className="disconnect-button" disabled={!!busy} onClick={removeKey}>Retirer ma clé Fish Audio</button>}</section><aside className="panel setup-guide"><span className="small-voice-icon"><PlugZap size={25} /></span><h2>La première fois ?</h2><ol><li>Ouvre ton compte Fish Audio et crée une clé API.</li><li>Ajoute la clé dans ce formulaire.</li><li>Choisis une voix dans « Les voix ».</li><li>Installe Fish Audio depuis tes plugins personnels, puis utilise-le dans ChatGPT.</li></ol><a className="secondary" href="https://fish.audio" target="_blank" rel="noreferrer">Ouvrir Fish Audio <ArrowUpRight size={16} /></a><p>Plugin personnel indépendant, connecté à l’API Fish Audio.</p></aside></div></>}
        <footer>Fish Audio <span>·</span> Intégration indépendante pour tes voix off. <span>·</span><a href="/diagnostic">Diagnostic du plugin</a></footer>
      </main>
    </div>
  </div>;
}
