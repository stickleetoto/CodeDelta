'use strict';

function getNonce() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let value = '';
  for (let i = 0; i < 32; i += 1) value += chars.charAt(Math.floor(Math.random() * chars.length));
  return value;
}

function panelHtml({ cspSource }) {
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
    * { box-sizing: border-box; }
    body { margin:0; padding:9px 12px 11px; color:var(--vscode-foreground); background:var(--vscode-sideBar-background,var(--vscode-editor-background)); font-family:var(--vscode-font-family); font-size:12px; overflow-x:hidden; }
    button { font:inherit; cursor:pointer; }
    .top { display:flex; align-items:center; gap:9px; min-width:0; margin-bottom:7px; }
    .brand { display:flex; align-items:center; gap:7px; min-width:max-content; }
    .brand strong { font-size:13px; }
    .scope-label,.muted { color:var(--vscode-descriptionForeground); }
    .tracking { display:flex; align-items:center; gap:5px; padding:2px 6px; border-radius:999px; border:1px solid var(--vscode-widget-border,var(--vscode-editorWidget-border)); white-space:nowrap; color:var(--vscode-descriptionForeground); }
    .dot { width:6px; height:6px; border-radius:50%; background:var(--vscode-testing-iconPassed,var(--vscode-gitDecoration-addedResourceForeground)); }
    .tracking.partial .dot { background:var(--vscode-editorWarning-foreground); }
    .tracking.off .dot { background:var(--vscode-descriptionForeground); }
    .tabs { display:flex; gap:3px; flex-wrap:wrap; margin-left:auto; }
    .scope,.full { border:1px solid var(--vscode-widget-border,transparent); color:var(--vscode-button-secondaryForeground); background:var(--vscode-button-secondaryBackground); border-radius:4px; padding:3px 7px; }
    .scope:hover,.full:hover { background:var(--vscode-button-secondaryHoverBackground); }
    .scope.active { color:var(--vscode-button-foreground); background:var(--vscode-button-background); border-color:transparent; }
    .full { white-space:nowrap; }
    .metrics { display:grid; grid-template-columns:repeat(4,minmax(95px,1fr)); gap:6px; margin-bottom:7px; }
    .metric { display:flex; align-items:center; justify-content:space-between; gap:8px; min-width:0; padding:7px 9px; border:1px solid var(--vscode-widget-border,var(--vscode-editorWidget-border)); background:var(--vscode-editorWidget-background,var(--vscode-sideBar-background)); border-radius:6px; }
    .metric .label { color:var(--vscode-descriptionForeground); white-space:nowrap; }
    .metric strong { font-size:14px; font-variant-numeric:tabular-nums; white-space:nowrap; }
    .added { color:var(--vscode-gitDecoration-addedResourceForeground,#3fb950); }
    .removed { color:var(--vscode-gitDecoration-deletedResourceForeground,#f85149); }
    .activity { display:flex; gap:5px; flex-wrap:wrap; margin-bottom:7px; color:var(--vscode-descriptionForeground); }
    .chip { padding:2px 6px; border-radius:999px; border:1px solid var(--vscode-widget-border,var(--vscode-editorWidget-border)); white-space:nowrap; }
    .content { display:grid; grid-template-columns:minmax(180px,.8fr) minmax(260px,1.4fr); gap:8px; }
    .section { min-width:0; border:1px solid var(--vscode-widget-border,var(--vscode-editorWidget-border)); border-radius:6px; overflow:hidden; }
    .section-title { padding:5px 8px; color:var(--vscode-descriptionForeground); border-bottom:1px solid var(--vscode-widget-border,var(--vscode-editorWidget-border)); display:flex; justify-content:space-between; gap:10px; }
    .mini-row,.file-row { width:100%; min-width:0; display:flex; align-items:center; justify-content:space-between; gap:10px; padding:5px 8px; border:0; border-radius:0; background:transparent; color:var(--vscode-foreground); text-align:left; }
    .mini-row + .mini-row,.file-row + .file-row { border-top:1px solid color-mix(in srgb,var(--vscode-foreground) 8%,transparent); }
    .file-row:hover { background:var(--vscode-list-hoverBackground); }
    .name { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .delta { display:flex; gap:8px; flex:none; font-variant-numeric:tabular-nums; }
    .empty { padding:8px; color:var(--vscode-descriptionForeground); }
    @media (max-width:720px) { .top{align-items:flex-start;flex-wrap:wrap}.tabs{margin-left:0}.metrics{grid-template-columns:1fr 1fr}.content{grid-template-columns:1fr}.tracking{order:3} }
  </style>
</head>
<body>
  <div class="top">
    <div class="brand"><strong>CodeDelta</strong><span class="scope-label" id="scopeLabel">Session</span></div>
    <div class="tracking off" id="tracking" title="External tracking status"><span class="dot"></span><span id="trackingText">Starting…</span></div>
    <div class="tabs" id="tabs">
      <button class="scope" data-scope="session">Session</button><button class="scope" data-scope="today">Today</button><button class="scope" data-scope="workspace">Workspace</button><button class="scope" data-scope="allTime">All Time</button>
    </div>
    <button class="full" id="fullDashboard">Full dashboard</button>
  </div>
  <div class="metrics">
    <div class="metric"><span class="label">Added</span><strong class="added" id="added">+0</strong></div>
    <div class="metric"><span class="label">Removed</span><strong class="removed" id="removed">-0</strong></div>
    <div class="metric"><span class="label">Net</span><strong id="net">+0</strong></div>
    <div class="metric"><span class="label">Total</span><strong id="total">0</strong></div>
  </div>
  <div class="activity">
    <span class="chip">Created <b id="created">0</b></span><span class="chip">Edited files <b id="modified">0</b></span><span class="chip">Deleted <b id="deleted">0</b></span><span class="chip">Renamed <b id="renamed">0</b></span>
  </div>
  <div class="content">
    <section class="section"><div class="section-title"><span>Top languages</span><span id="languageCount"></span></div><div id="languages"><div class="empty">No language changes yet.</div></div></section>
    <section class="section"><div class="section-title"><span>Top files · click to open</span><span id="fileCount"></span></div><div id="files"><div class="empty">No file changes yet.</div></div></section>
  </div>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const fmt = new Intl.NumberFormat('en-US');
    const $ = (id) => document.getElementById(id);
    const signed = (n) => (n >= 0 ? '+' : '-') + fmt.format(Math.abs(n));
    const setText = (id, value) => { $(id).textContent = value; };
    function renderRows(root, rows, clickable) {
      root.replaceChildren();
      if (!rows.length) { const e=document.createElement('div'); e.className='empty'; e.textContent=clickable?'No file changes yet.':'No language changes yet.'; root.appendChild(e); return; }
      for (const row of rows) {
        const el=document.createElement(clickable?'button':'div'); el.className=clickable?'file-row':'mini-row';
        const name=document.createElement('span'); name.className='name'; name.textContent=row.name; name.title=row.name;
        const d=document.createElement('span'); d.className='delta';
        const a=document.createElement('span'); a.className='added'; a.textContent='+'+fmt.format(row.added);
        const r=document.createElement('span'); r.className='removed'; r.textContent='-'+fmt.format(row.removed);
        d.append(a,r); el.append(name,d);
        if (clickable && row.uri) el.addEventListener('click',()=>vscode.postMessage({type:'openFile',uri:row.uri}));
        root.appendChild(el);
      }
    }
    function render(data) {
      setText('scopeLabel',data.scopeLabel); setText('added','+'+fmt.format(data.added)); setText('removed','-'+fmt.format(data.removed));
      setText('net',signed(data.added-data.removed)); setText('total',fmt.format(data.added+data.removed));
      setText('created',fmt.format(data.activity.created)); setText('modified',fmt.format(data.activity.modified)); setText('deleted',fmt.format(data.activity.deleted)); setText('renamed',fmt.format(data.activity.renamed));
      document.querySelectorAll('[data-scope]').forEach(b=>b.classList.toggle('active',b.dataset.scope===data.scope));
      const tracking=$('tracking'); tracking.classList.remove('partial','off');
      if (!data.tracking.external) { tracking.classList.add('off'); setText('trackingText','Editor only'); }
      else if (data.tracking.priming) { tracking.classList.add('partial'); setText('trackingText','Indexing…'); }
      else if (data.tracking.partial) { tracking.classList.add('partial'); setText('trackingText','Partial · '+fmt.format(data.tracking.files)+' files'); }
      else { setText('trackingText','Live · '+fmt.format(data.tracking.files)+' files'); }
      tracking.title=data.tracking.detail || 'External tracking status';
      setText('languageCount',data.languages.length?('Top '+data.languages.length):''); setText('fileCount',data.files.length?('Top '+data.files.length):'');
      renderRows($('languages'),data.languages,false); renderRows($('files'),data.files,true);
    }
    document.querySelectorAll('[data-scope]').forEach(b=>b.addEventListener('click',()=>vscode.postMessage({type:'scope',scope:b.dataset.scope})));
    $('fullDashboard').addEventListener('click',()=>vscode.postMessage({type:'fullDashboard'}));
    window.addEventListener('message',(event)=>{ if(event.data?.type==='state') render(event.data.payload); });
    vscode.postMessage({type:'ready'});
  </script>
</body>
</html>`;
}

module.exports = { panelHtml };
