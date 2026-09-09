'use strict';

function getNonce() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let value = '';
  for (let i = 0; i < 32; i += 1) value += chars.charAt(Math.floor(Math.random() * chars.length));
  return value;
}

function gitPanelHtml({ cspSource, full = false }) {
  const nonce = getNonce();
  const fullClass = full ? ' full' : '';
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'; img-src ${cspSource} data:;">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>CodeDelta Git</title>
  <style>
    :root { color-scheme: light dark; }
    * { box-sizing:border-box; }
    body { margin:0; padding:${full ? '26px' : '10px 12px 12px'}; color:var(--vscode-foreground); background:var(--vscode-sideBar-background,var(--vscode-editor-background)); font-family:var(--vscode-font-family); font-size:12px; }
    body.full { background:var(--vscode-editor-background); }
    .wrap { max-width:${full ? '1060px' : 'none'}; margin:0 auto; }
    header { display:flex; align-items:center; justify-content:space-between; gap:10px; margin-bottom:10px; }
    .brand { min-width:0; }
    h1 { margin:0; font-size:${full ? '22px' : '13px'}; font-weight:650; }
    .sub { margin-top:3px; color:var(--vscode-descriptionForeground); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
    button { font:inherit; cursor:pointer; color:var(--vscode-button-secondaryForeground); background:var(--vscode-button-secondaryBackground); border:1px solid var(--vscode-widget-border,transparent); border-radius:5px; padding:4px 8px; }
    button:hover { background:var(--vscode-button-secondaryHoverBackground); }
    .metrics { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:7px; margin-bottom:10px; }
    .card,.repo,.history { border:1px solid var(--vscode-widget-border,var(--vscode-editorWidget-border)); background:var(--vscode-editorWidget-background,var(--vscode-sideBar-background)); border-radius:7px; }
    .card { padding:9px 10px; min-width:0; }
    .label { color:var(--vscode-descriptionForeground); font-size:11px; }
    .value { margin-top:5px; font-size:${full ? '20px' : '14px'}; font-weight:700; font-variant-numeric:tabular-nums; }
    .added { color:var(--vscode-gitDecoration-addedResourceForeground,#3fb950); }
    .removed { color:var(--vscode-gitDecoration-deletedResourceForeground,#f85149); }
    .section-title { margin:11px 0 6px; color:var(--vscode-descriptionForeground); font-size:11px; text-transform:uppercase; letter-spacing:.45px; }
    .repo-list,.history-list { display:grid; gap:6px; }
    .repo { padding:8px 9px; }
    .repo-top { display:flex; justify-content:space-between; gap:10px; min-width:0; }
    .repo-name { font-weight:600; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .branch { color:var(--vscode-descriptionForeground); white-space:nowrap; font-family:var(--vscode-editor-font-family,monospace); }
    .repo-delta { margin-top:5px; display:flex; gap:10px; font-variant-numeric:tabular-nums; }
    .repo-meta { margin-top:4px; color:var(--vscode-descriptionForeground); }
    .history { padding:7px 9px; display:flex; justify-content:space-between; gap:10px; }
    .history-main { min-width:0; }
    .history-head { font-family:var(--vscode-editor-font-family,monospace); }
    .history-detail { margin-top:3px; color:var(--vscode-descriptionForeground); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
    .history-delta { display:flex; align-items:center; gap:8px; white-space:nowrap; font-variant-numeric:tabular-nums; }
    .empty { padding:9px; border:1px dashed var(--vscode-widget-border,var(--vscode-editorWidget-border)); border-radius:7px; color:var(--vscode-descriptionForeground); }
    .note { margin-top:9px; color:var(--vscode-descriptionForeground); line-height:1.4; }
    @media (max-width:720px) { .metrics{grid-template-columns:1fr 1fr}.history{align-items:flex-start;flex-direction:column}.history-delta{align-self:flex-end} }
  </style>
</head>
<body class="${fullClass.trim()}">
  <div class="wrap">
    <header>
      <div class="brand"><h1>${full ? 'CodeDelta · Git Awareness' : 'Git Awareness'}</h1><div class="sub" id="summary">Detecting repositories…</div></div>
      ${full ? '<button id="reset">Reset checkpoint</button>' : '<button id="openFull">Full</button>'}
    </header>
    <section class="metrics">
      <div class="card"><div class="label">Since commit · Added</div><div class="value added" id="added">+0</div></div>
      <div class="card"><div class="label">Removed</div><div class="value removed" id="removed">-0</div></div>
      <div class="card"><div class="label">Net</div><div class="value" id="net">+0</div></div>
      <div class="card"><div class="label">Edited files</div><div class="value" id="modified">0</div></div>
    </section>
    <div class="section-title">Repositories</div>
    <div class="repo-list" id="repos"><div class="empty">No Git repository detected.</div></div>
    <div class="section-title">Recent boundaries</div>
    <div class="history-list" id="history"><div class="empty">No observed commit boundary yet.</div></div>
    <div class="note" id="note">Since Commit uses CodeDelta's observed development counters, not git diff output.</div>
  </div>
  <script nonce="${nonce}">
    const vscode=acquireVsCodeApi(); const fmt=new Intl.NumberFormat('en-US'); const $=(id)=>document.getElementById(id);
    const signed=(n)=>(n>=0?'+':'-')+fmt.format(Math.abs(n));
    function repoRow(repo){const el=document.createElement('div');el.className='repo';const top=document.createElement('div');top.className='repo-top';const name=document.createElement('div');name.className='repo-name';name.textContent=repo.name;name.title=repo.root;const branch=document.createElement('div');branch.className='branch';branch.textContent=repo.branch+' · '+(repo.head||'no HEAD');top.append(name,branch);const delta=document.createElement('div');delta.className='repo-delta';const a=document.createElement('span');a.className='added';a.textContent='+'+fmt.format(repo.added);const r=document.createElement('span');r.className='removed';r.textContent='-'+fmt.format(repo.removed);const net=document.createElement('span');net.textContent='net '+signed(repo.added-repo.removed);delta.append(a,r,net);const meta=document.createElement('div');meta.className='repo-meta';meta.textContent=fmt.format(repo.modified)+' edited · '+fmt.format(repo.created)+' created · '+fmt.format(repo.deleted)+' deleted · '+fmt.format(repo.renamed)+' renamed';el.append(top,delta,meta);return el;}
    function historyRow(item){const el=document.createElement('div');el.className='history';const main=document.createElement('div');main.className='history-main';const head=document.createElement('div');head.className='history-head';head.textContent=(item.branch||'unknown')+' · '+(item.head||'unknown');const detail=document.createElement('div');detail.className='history-detail';detail.textContent=item.repo+' · '+new Date(item.endedAt).toLocaleString();main.append(head,detail);const delta=document.createElement('div');delta.className='history-delta';const a=document.createElement('span');a.className='added';a.textContent='+'+fmt.format(item.added);const r=document.createElement('span');r.className='removed';r.textContent='-'+fmt.format(item.removed);delta.append(a,r);el.append(main,delta);return el;}
    function render(data){$('added').textContent='+'+fmt.format(data.added);$('removed').textContent='-'+fmt.format(data.removed);$('net').textContent=signed(data.added-data.removed);$('modified').textContent=fmt.format(data.activity.modified);$('summary').textContent=data.available?(data.repoCount+' Git repo'+(data.repoCount===1?'':'s')+' · '+(data.primary?data.primary.branch+' '+data.primary.head:'ready')):(data.error||'Git integration unavailable');const repos=$('repos');repos.replaceChildren();if(!data.repos.length){const e=document.createElement('div');e.className='empty';e.textContent='No Git repository detected.';repos.appendChild(e);}else for(const repo of data.repos)repos.appendChild(repoRow(repo));const history=$('history');history.replaceChildren();if(!data.history.length){const e=document.createElement('div');e.className='empty';e.textContent='No observed commit boundary yet.';history.appendChild(e);}else for(const item of data.history)history.appendChild(historyRow(item));$('note').textContent=data.note||'Since Commit uses CodeDelta observed development counters.';}
    const full=$('openFull');if(full)full.addEventListener('click',()=>vscode.postMessage({type:'full'}));const reset=$('reset');if(reset)reset.addEventListener('click',()=>vscode.postMessage({type:'reset'}));window.addEventListener('message',(event)=>{if(event.data?.type==='state')render(event.data.payload);});vscode.postMessage({type:'ready'});
  </script>
</body>
</html>`;
}

module.exports = { gitPanelHtml };
