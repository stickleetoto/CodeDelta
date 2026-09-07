'use strict';

function getNonce() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let value = '';
  for (let i = 0; i < 32; i += 1) value += chars.charAt(Math.floor(Math.random() * chars.length));
  return value;
}

function dashboardHtml({ cspSource }) {
  const nonce = getNonce();
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'; img-src ${cspSource} data:;">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>CodeDelta</title>
  <style>
    :root { color-scheme: light dark; }
    * { box-sizing:border-box; }
    body { margin:0; padding:28px; color:var(--vscode-foreground); background:var(--vscode-editor-background); font-family:var(--vscode-font-family); font-size:var(--vscode-font-size); }
    .wrap { max-width:1120px; margin:0 auto; }
    header { display:flex; align-items:flex-end; justify-content:space-between; gap:16px; margin-bottom:18px; }
    .titleline { display:flex; align-items:center; gap:9px; }
    h1 { margin:0; font-size:24px; font-weight:650; letter-spacing:-.3px; }
    .subtitle { margin-top:5px; color:var(--vscode-descriptionForeground); }
    .tracking { display:inline-flex; align-items:center; gap:6px; padding:3px 8px; border-radius:999px; border:1px solid var(--vscode-widget-border,var(--vscode-editorWidget-border)); color:var(--vscode-descriptionForeground); font-size:11px; }
    .dot { width:7px; height:7px; border-radius:50%; background:var(--vscode-testing-iconPassed,var(--vscode-gitDecoration-addedResourceForeground)); }
    .tracking.partial .dot { background:var(--vscode-editorWarning-foreground); }
    .tracking.off .dot { background:var(--vscode-descriptionForeground); }
    .scope-tabs { display:flex; flex-wrap:wrap; gap:6px; }
    button { color:var(--vscode-button-secondaryForeground); background:var(--vscode-button-secondaryBackground); border:1px solid var(--vscode-widget-border,transparent); border-radius:6px; padding:6px 10px; font:inherit; cursor:pointer; }
    button:hover { background:var(--vscode-button-secondaryHoverBackground); }
    button.active { color:var(--vscode-button-foreground); background:var(--vscode-button-background); border-color:transparent; }
    .hero { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:10px; margin-bottom:12px; }
    .card,.section { border:1px solid var(--vscode-widget-border,var(--vscode-editorWidget-border)); background:var(--vscode-editorWidget-background,var(--vscode-sideBar-background)); border-radius:10px; }
    .card { padding:17px 18px; min-height:98px; }
    .card-label { color:var(--vscode-descriptionForeground); font-size:12px; text-transform:uppercase; letter-spacing:.5px; }
    .card-value { margin-top:8px; font-size:24px; font-weight:700; font-variant-numeric:tabular-nums; white-space:nowrap; }
    .added { color:var(--vscode-gitDecoration-addedResourceForeground,#3fb950); }
    .removed { color:var(--vscode-gitDecoration-deletedResourceForeground,#f85149); }
    .muted { color:var(--vscode-descriptionForeground); }
    .activity { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:10px; margin-bottom:16px; }
    .activity .card { min-height:auto; padding:12px 14px; display:flex; justify-content:space-between; align-items:center; }
    .activity strong { font-size:18px; font-variant-numeric:tabular-nums; }
    .grid { display:grid; grid-template-columns:1fr 1fr; gap:16px; }
    .section { padding:16px; min-width:0; }
    .section.files { grid-column:1 / -1; }
    .section-head { display:flex; justify-content:space-between; align-items:center; margin-bottom:12px; }
    h2 { margin:0; font-size:14px; font-weight:650; }
    .section-note { color:var(--vscode-descriptionForeground); font-size:11px; }
    .stat-row { padding:8px 0; border-top:1px solid color-mix(in srgb,var(--vscode-foreground) 10%,transparent); }
    .stat-row:first-child { border-top:0; }
    .stat-row.clickable { cursor:pointer; border-radius:5px; padding-left:6px; padding-right:6px; }
    .stat-row.clickable:hover { background:var(--vscode-list-hoverBackground); }
    .row-main { display:flex; align-items:center; justify-content:space-between; gap:14px; }
    .row-title { min-width:0; overflow:hidden; white-space:nowrap; text-overflow:ellipsis; font-weight:500; }
    .delta { display:flex; gap:10px; flex:none; font-variant-numeric:tabular-nums; font-size:12px; }
    .bar { height:3px; margin-top:6px; border-radius:3px; background:color-mix(in srgb,var(--vscode-foreground) 12%,transparent); overflow:hidden; }
    .bar span { display:block; height:100%; background:var(--vscode-foreground); opacity:.55; }
    .row-detail { margin-top:4px; color:var(--vscode-descriptionForeground); font-size:11px; }
    .empty { color:var(--vscode-descriptionForeground); padding:10px 0; }
    footer { margin-top:16px; display:flex; justify-content:space-between; gap:12px; flex-wrap:wrap; color:var(--vscode-descriptionForeground); font-size:11px; }
    @media (max-width:760px) { body{padding:18px} header{align-items:flex-start;flex-direction:column}.hero{grid-template-columns:1fr 1fr}.activity{grid-template-columns:1fr 1fr}.grid{grid-template-columns:1fr}.section.files{grid-column:auto} }
  </style>
</head>
<body>
  <div class="wrap">
    <header>
      <div><div class="titleline"><h1>CodeDelta</h1><div class="tracking off" id="tracking"><span class="dot"></span><span id="trackingText">Starting…</span></div></div><div class="subtitle" id="subtitle">Session · VS Code + coding-agent text changes</div></div>
      <div class="scope-tabs"><button data-scope="session">Session</button><button data-scope="today">Today</button><button data-scope="workspace">Workspace</button><button data-scope="allTime">All Time</button></div>
    </header>
    <section class="hero">
      <div class="card"><div class="card-label">Added</div><div class="card-value added" id="added">+0</div></div>
      <div class="card"><div class="card-label">Removed</div><div class="card-value removed" id="removed">-0</div></div>
      <div class="card"><div class="card-label">Net</div><div class="card-value" id="net">+0</div></div>
      <div class="card"><div class="card-label">Total change</div><div class="card-value" id="total">0</div></div>
    </section>
    <section class="activity">
      <div class="card"><span class="muted">Created</span><strong id="created">0</strong></div><div class="card"><span class="muted">Edited files</span><strong id="modified">0</strong></div><div class="card"><span class="muted">Deleted</span><strong id="deleted">0</strong></div><div class="card"><span class="muted">Renamed</span><strong id="renamed">0</strong></div>
    </section>
    <div class="grid">
      <section class="section"><div class="section-head"><h2>Languages</h2><span class="section-note" id="languageNote"></span></div><div id="languages"><div class="empty">No language changes yet.</div></div></section>
      <section class="section"><div class="section-head"><h2>Folders</h2><span class="section-note">Recursive totals</span></div><div id="folders"><div class="empty">No folder changes yet.</div></div></section>
      <section class="section files"><div class="section-head"><h2>Files</h2><span class="section-note">Click a file to open it</span></div><div id="files"><div class="empty">No file changes yet.</div></div></section>
    </div>
    <footer><span>New files: full initial text → +added · Deletes: last tracked text → -removed · Renames/moves: 0 character delta.</span><span id="trackingDetail"></span></footer>
  </div>
  <script nonce="${nonce}">
    const vscode=acquireVsCodeApi(); const fmt=new Intl.NumberFormat('en-US'); const $=(id)=>document.getElementById(id);
    const signed=(n)=>(n>=0?'+':'-')+fmt.format(Math.abs(n)); const setText=(id,v)=>{$(id).textContent=v;};
    function row(entry, clickable) {
      const el=document.createElement('div'); el.className='stat-row'+(clickable?' clickable':'');
      const main=document.createElement('div'); main.className='row-main'; const title=document.createElement('div'); title.className='row-title'; title.textContent=entry.name; title.title=entry.name;
      const delta=document.createElement('div'); delta.className='delta'; const a=document.createElement('span'); a.className='added'; a.textContent='+'+fmt.format(entry.added); const r=document.createElement('span'); r.className='removed'; r.textContent='-'+fmt.format(entry.removed); delta.append(a,r); main.append(title,delta);
      const bar=document.createElement('div'); bar.className='bar'; const fill=document.createElement('span'); fill.style.width=(entry.percent||3)+'%'; bar.appendChild(fill); el.append(main,bar);
      if(entry.detail){const d=document.createElement('div'); d.className='row-detail'; d.textContent=entry.detail; el.appendChild(d);} if(clickable&&entry.uri) el.addEventListener('click',()=>vscode.postMessage({type:'openFile',uri:entry.uri})); return el;
    }
    function renderList(root, entries, emptyText, clickable=false) { root.replaceChildren(); if(!entries.length){const e=document.createElement('div');e.className='empty';e.textContent=emptyText;root.appendChild(e);return;} for(const x of entries) root.appendChild(row(x,clickable)); }
    function render(data) {
      document.title='CodeDelta — '+data.scopeLabel; setText('subtitle',data.scopeLabel+' · VS Code + coding-agent text changes');
      setText('added','+'+fmt.format(data.added)); setText('removed','-'+fmt.format(data.removed)); setText('net',signed(data.added-data.removed)); setText('total',fmt.format(data.added+data.removed));
      setText('created',fmt.format(data.activity.created)); setText('modified',fmt.format(data.activity.modified)); setText('deleted',fmt.format(data.activity.deleted)); setText('renamed',fmt.format(data.activity.renamed));
      document.querySelectorAll('[data-scope]').forEach(b=>b.classList.toggle('active',b.dataset.scope===data.scope));
      const tracking=$('tracking'); tracking.classList.remove('partial','off'); if(!data.tracking.external){tracking.classList.add('off');setText('trackingText','Editor only');}else if(data.tracking.priming){tracking.classList.add('partial');setText('trackingText','Indexing…');}else if(data.tracking.partial){tracking.classList.add('partial');setText('trackingText','Partial');}else setText('trackingText','Live'); tracking.title=data.tracking.detail||''; setText('trackingDetail',data.tracking.detail||'');
      setText('languageNote',data.languages.length?('Top '+data.languages.length):''); renderList($('languages'),data.languages,'No language changes yet.'); renderList($('folders'),data.folders,'No folder changes yet.'); renderList($('files'),data.files,'No file changes yet.',true);
    }
    document.querySelectorAll('[data-scope]').forEach(b=>b.addEventListener('click',()=>vscode.postMessage({type:'scope',scope:b.dataset.scope}))); window.addEventListener('message',(event)=>{if(event.data?.type==='state')render(event.data.payload);}); vscode.postMessage({type:'ready'});
  </script>
</body>
</html>`;
}

module.exports = { dashboardHtml };
