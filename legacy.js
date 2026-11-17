(function(){
  var API='https://aora-group.hushengniaina.workers.dev';
  var toggle=document.querySelector('.menu-toggle'),nav=document.querySelector('.nav');
  if(toggle&&nav){toggle.onclick=function(){var open=nav.className.indexOf('open')<0;nav.className=open?'nav open':'nav';toggle.setAttribute('aria-expanded',open?'true':'false');};}
  var year=document.getElementById('year');if(year)year.textContent=(new Date()).getFullYear();
  var grid=document.getElementById('app-grid'),detail=document.getElementById('app-detail'),content=document.getElementById('app-detail-content'),close=document.getElementById('detail-close');
  var demos=[
    ['WhatsApp','W','#25D366','Communication','Messagerie et appels — fiche de démonstration.'],
    ['Instagram','◎','#C13584','Réseaux sociaux','Photos, vidéos et stories — fiche de démonstration.'],
    ['TikTok','♪','#111111','Divertissement','Vidéos courtes — fiche de démonstration.'],
    ['YouTube','▶','#FF0033','Vidéo','Plateforme de vidéos — fiche de démonstration.'],
    ['Telegram','➤','#229ED9','Communication','Messagerie et communautés — fiche de démonstration.'],
    ['Spotify','≋','#1DB954','Musique','Musique et podcasts — fiche de démonstration.'],
    ['Gmail','M','#EA4335','Productivité','Courrier électronique — fiche de démonstration.'],
    ['Google Maps','⌖','#4285F4','Navigation','Cartes et navigation — fiche de démonstration.'],
    ['Yuniko','Y','#7657E8','Réseaux sociaux','Aperçu du projet Yuniko.'],
    ['i-tafa','i','#14B8A6','Productivité','Aperçu du projet i-tafa.']
  ];
  function icon(letter,color){return 'data:image/svg+xml;charset=UTF-8,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128"><rect width="128" height="128" rx="28" fill="'+color+'"/><text x="64" y="86" font-family="Arial" font-size="76" font-weight="bold" text-anchor="middle" fill="white">'+letter+'</text></svg>');}
  function esc(s){return String(s||'').replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
  var apps=[];
  function render(){var html='',i,a;for(i=0;i<apps.length;i++){a=apps[i];html+='<button class="app-tile" type="button" data-index="'+i+'"><span class="tile-icon">'+(a.icon_url?'<img src="'+esc(a.icon_url)+'" alt="">':'<span class="tile-letter">'+esc((a.name||'?').charAt(0))+'</span>')+'</span><span class="tile-name">'+esc(a.name)+'</span><span class="tile-category">'+esc(a.category||'Application')+'</span></button>';}grid.innerHTML=html;}
  function show(a){var demo=a.demo===true,shots=a.screenshots||[],html='<div class="detail-head"><div class="detail-icon">'+(a.icon_url?'<img src="'+esc(a.icon_url)+'" alt="">':'<span>'+esc((a.name||'?').charAt(0))+'</span>')+'</div><div><div class="eyebrow">'+(demo?'DÉMONSTRATION • APERÇU':'APPLICATION OFFICIELLE')+'</div><h2>'+esc(a.name)+'</h2><p>'+esc(a.category||'Application')+' · '+esc(a.platform||'')+' · '+esc(a.version||'')+'</p></div></div><p class="detail-description">'+esc(a.description||'Application AORA GROUP.')+'</p>';
    if(shots.length){html+='<div class="screenshots"><div class="screenshots-title">DÉCOUVRIR L’APPLICATION</div><div class="screenshot-strip">';for(var j=0;j<shots.length;j++)html+='<img src="'+esc(shots[j])+'" alt="Capture application">';html+='</div></div>';}
    html+=a.download_url&&!demo?'<a class="button button-primary detail-download" href="'+esc(a.download_url)+'" download>Télécharger l’application ↓</a>':'<p class="coming-label">'+(demo?'Démo visuelle — aucun téléchargement disponible.':'Téléchargement bientôt disponible')+'</p>';
    content.innerHTML=html;detail.hidden=false;document.body.className+=' detail-open';
  }
  if(grid){for(var i=0;i<demos.length;i++){var d=demos[i];apps.push({id:'demo-'+i,name:d[0],icon_url:icon(d[1],d[2]),category:d[3],description:d[4],version:'Démo',platform:'Android / iOS / Web',screenshots:[],demo:true});}
    grid.onclick=function(e){var node=e.target;while(node&&node!==grid&&!(node.getAttribute&&node.getAttribute('data-index')!==null))node=node.parentNode;if(node&&node!==grid){var index=parseInt(node.getAttribute('data-index'),10);if(apps[index])show(apps[index]);}};
    if(window.fetch){fetch(API+'/api/apps').then(function(r){if(!r.ok)throw new Error('offline');return r.json();}).then(function(data){var remote=data.apps||[],i,j,exists;for(i=0;i<remote.length;i++){exists=false;for(j=0;j<apps.length;j++)if(String(apps[j].name).toLowerCase()===String(remote[i].name).toLowerCase())exists=true;if(!exists)apps.push(remote[i]);}render();}).catch(function(){render();});}else render();
  }
  function hide(){if(detail)detail.hidden=true;document.body.className=document.body.className.replace(' detail-open','');}
  if(close)close.onclick=hide;if(detail)detail.onclick=function(e){if(e.target===detail)hide();};document.onkeydown=function(e){e=e||window.event;if((e.key==='Escape'||e.keyCode===27)&&detail)hide();};
  var links=document.querySelectorAll('.nav a');for(var k=0;k<links.length;k++)links[k].onclick=function(){if(nav)nav.className='nav';if(toggle)toggle.setAttribute('aria-expanded','false');};
})();