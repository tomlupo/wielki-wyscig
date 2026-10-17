from pathlib import Path
p=Path('src/main.js');s=p.read_text()
start=s.index('function bike(color)');end=s.index('const riders=ends.map',start);s=s[:start]+s[end:]
s=s.replace("const body=bike(colors[i]);scene.add(body);return {finish,name:names[i],pin,body,samples:[]}","return {finish,name:names[i],pin,samples:[]}")
s=s.replace("r.body.position.copy(pos);let dir=point(Math.min(len,dist+5)).sub(point(Math.max(0,dist-5)));r.body.rotation.y=Math.atan2(-dir.x,-dir.z);r.body.scale.setScalar(2);",'')
s=s.replace("r.body.visible=!(mode==='ride'&&i===selected)",'')
s=s.replace("'Rider view'","'Road view'")
s=s.replace("r.el.querySelector('.bw-gap').textContent=time>=r.finish?'Finished':i===lead?'Leader':'+'+fmt(gap);", "const rank=ranking.indexOf(i)+1;r.el.querySelector('.bw-gap').textContent='#'+rank+' · '+(time>=r.finish?'Finished':i===lead?'Leader':'+'+fmt(gap));r.el.querySelector('.bw-progress-fill').style.width=(distances[i]/len*100)+'%';")
s=s.replace("lead=distances.indexOf(Math.max(...distances));riders.forEach", "ranking=riders.map((_,i)=>i).sort((a,b)=>distances[b]-distances[a]||ends[a]-ends[b]),lead=ranking[0];riders.forEach")
s=s.replace("<small>${fmt(r.finish)} finish</small>","<small>${fmt(r.finish)} finish</small><div class=\"bw-progress\"><div class=\"bw-progress-fill\" style=\"background:${cssColors[i]}\"></div></div>")
s=s.replace("el.onclick=()=>{selected=i;updateUI();charts()}","el.onclick=()=>{selected=i;root.style.setProperty('--rider-color',cssColors[i]);if(!webgl&&mode==='free')focus.copy(point(distanceAt(i,time)));updateUI();charts()}")
s=s.replace("$('bw-detail').textContent=", "$('bw-selected-name').textContent=names[selected];$('bw-distance').textContent=((len-d)/1000).toFixed(2)+' km to go';$('bw-results').hidden=time<duration;if(time>=duration)$('bw-results-list').innerHTML=ranking.map((i,n)=>'<li><span>'+String(n+1).padStart(2,'0')+' · '+escapeHtml(names[i])+'</span><strong>'+fmt(ends[i])+'</strong><span>'+(n?'+'+fmt(ends[i]-ends[ranking[0]]):'Winner')+'</span></li>').join('');$('bw-detail').textContent=")
# Bigger race progress labels, improve initial perspective and smooth camera transitions.
s=s.replace("radius=6200,theta=.5,phi=.78", "radius=6000,theta=.35,phi=.95")
s=s.replace("radius=6200;theta=.5;phi=.78", "radius=6000;theta=.35;phi=.95")
# Zoom controls now work for every camera mode.
s=s.replace("$('bw-in').onclick=()=>radius=Math.max(60,radius*.75);$('bw-out').onclick=()=>radius=Math.min(11000,radius/ .75);", "$('bw-in').onclick=()=>{if(mode==='chase'||mode==='ride')setMode('free');radius=Math.max(60,radius*.75)};$('bw-out').onclick=()=>{if(mode==='chase'||mode==='ride')setMode('free');radius=Math.min(11000,radius/.75)};")
# Padding around route rather than the entire survey rectangle for the 2D fallback.
s=s.replace("scale=Math.min(w/width,h/depth)*Math.min(8,6200/radius)", "scale=Math.min(w/width,h/5400)*Math.min(8,6000/radius)")
s=s.replace("new T.SpriteMaterial({map:tx,depthTest:false,transparent:true})", "new T.SpriteMaterial({map:tx,depthTest:false,transparent:true})")
# Use small labeled circular points, not cartoon cyclist/pin avatars.
s=s.replace("ctx.beginPath();ctx.moveTo(48,83);ctx.lineTo(64,114);ctx.lineTo(80,83);ctx.fill();",'')
p.write_text(s)
p=Path('index.html');s=p.read_text().replace('Inside Coll de sa Batalla','Coll de sa Batalla').replace('Rider view','Road view').replace('Chase rider','Follow rider')
s=s.replace('<div class="bw-telemetry">','<div class="bw-selected"><span><span class="bw-selected-dot"></span><strong id="bw-selected-name">Diesel</strong></span><span id="bw-distance">2.52 km to go</span></div><div class="bw-telemetry">')
s=s.replace('<div class="bw-caption">','<section id="bw-results" class="bw-results" hidden><div class="bw-sub">AT THE SUMMIT</div><h2>Every effort. One climb.</h2><ol id="bw-results-list"></ol></section><div class="bw-caption">')
p.write_text(s)
p=Path('src/style.css');s=p.read_text();s+='''
#batalla-world{--rider-color:#ffd34d}
#batalla-world .bw-head{padding:16px 0 20px}
#batalla-world h2{font-size:30px;letter-spacing:-1px}
#batalla-world .bw-tools button{min-height:44px;padding:10px 15px}
#batalla-world .bw-layout{grid-template-columns:minmax(0,1fr) 180px}
#batalla-world .bw-world{height:clamp(460px,62vh,700px);border-radius:12px}
#batalla-world .bw-rider{position:relative;overflow:hidden;border-radius:8px;background:#18251e;padding:14px 12px;color:#dce8dc;border-color:#344538;min-height:84px}
#batalla-world .bw-rider[aria-pressed=true]{background:#263c2d;color:#fff;border-color:#acc7a2}
#batalla-world .bw-rider small{color:inherit;opacity:.75}
#batalla-world .bw-progress{height:3px;background:#344438;margin-top:9px;border-radius:2px;overflow:hidden}
#batalla-world .bw-progress-fill{height:100%;width:0;transition:width .15s linear}
#batalla-world .bw-selected{display:flex;justify-content:space-between;align-items:center;font-size:13px;padding-top:18px;color:#b9cbbb}
#batalla-world .bw-selected strong{color:#f0f4ed;font-weight:500}
#batalla-world .bw-selected-dot{display:inline-block;background:var(--rider-color);width:8px;height:8px;border-radius:50%;margin-right:8px}
#batalla-world .bw-telemetry{padding:12px 0 14px;gap:12px}
#batalla-world .bw-stat strong{font-size:35px;font-variant-numeric:tabular-nums}
#batalla-world .bw-stat div{font-size:11px;letter-spacing:1.1px;color:#b8c4b9}
#batalla-world .bw-timebar{padding:12px 0;gap:12px}
#batalla-world .bw-timebar button{min-width:64px;min-height:46px;background:#e1edcf;color:#17261b;border:0}
#batalla-world .bw-timebar input{height:38px;accent-color:#d3e6bd}
#batalla-world .bw-timebar select{min-height:44px}
#batalla-world .bw-timebar output{color:#e2eadf}
#batalla-world .bw-chartgrid{border-top:1px solid #334135;padding-top:18px;margin-top:0}
#batalla-world .bw-results{padding:26px 0 10px}
#batalla-world .bw-results[hidden]{display:none}
#batalla-world .bw-results h2{margin:8px 0 18px}
#batalla-world .bw-results ol{padding:0;margin:0;list-style:none}
#batalla-world .bw-results li{display:grid;grid-template-columns:1fr 75px 70px;gap:12px;padding:13px 0;border-bottom:1px solid #344236;color:#c6d2c5;font-variant-numeric:tabular-nums}
#batalla-world .bw-results li:first-child{color:#f7d475}
#batalla-world .bw-results strong{font-weight:500}
#batalla-world .bw-chartgrid svg{height:115px}
@media(max-width:650px){
 main{padding:8px 14px 22px;padding-bottom:max(22px,env(safe-area-inset-bottom))}
 #batalla-world .bw-head{padding:12px 0 15px}
 #batalla-world h2{font-size:25px}
 #batalla-world .bw-head>.bw-sub{font-size:10px;letter-spacing:1px;margin-top:8px}
 #batalla-world .bw-tools{display:flex;gap:5px;flex-wrap:wrap}
 #batalla-world .bw-tools button{font-size:11px;padding:9px 10px;flex:1;white-space:nowrap}
 #batalla-world .bw-expand{display:none}
 #batalla-world .bw-layout{display:flex;flex-direction:column;gap:12px}
 #batalla-world .bw-world{height:clamp(350px,51svh,510px);border-radius:10px}
 #batalla-world .bw-hud{top:13px;left:13px}
 #batalla-world .bw-hud strong{font-size:17px}
 #batalla-world .bw-location{font-size:10px;max-width:72%;line-height:1.5}
 #batalla-world .bw-riders{display:flex;flex-direction:row;overflow-x:auto;gap:8px;padding-bottom:5px;scroll-snap-type:x proximity;scrollbar-width:thin}
 #batalla-world .bw-rider{flex:0 0 126px;min-height:92px;padding:11px 10px;scroll-snap-align:start;text-align:left}
 #batalla-world .bw-rider .bw-row{display:block;margin-bottom:5px;font-size:12px}
 #batalla-world .bw-rider .bw-name{display:inline}
 #batalla-world .bw-rider small{font-size:11px}
 #batalla-world .bw-gap{font-size:12px}
 #batalla-world .bw-selected{padding-top:10px;font-size:12px}
 #batalla-world .bw-stat strong{font-size:30px;letter-spacing:-.8px}
 #batalla-world .bw-stat{font-size:11px}
 #batalla-world .bw-telemetry{padding:12px 0 10px;gap:7px}
 #batalla-world .bw-detail{font-size:11px;line-height:1.5}
 #batalla-world .bw-timebar{position:sticky;bottom:0;z-index:4;background:#101814;padding:10px 0;padding-bottom:max(10px,env(safe-area-inset-bottom));display:grid;grid-template-columns:62px 1fr 61px;gap:6px 10px}
 #batalla-world .bw-timebar output{grid-column:2;grid-row:1;text-align:center;font-size:17px}
 #batalla-world .bw-timebar input{grid-column:1/-1;grid-row:2;width:100%;height:30px;margin:0;min-width:0}
 #batalla-world .bw-timebar label{grid-column:3;grid-row:1}
 #batalla-world .bw-timebar select{width:100%;padding:8px 5px}
 #batalla-world .bw-chartgrid{gap:8px;padding-top:14px}
 #batalla-world .bw-chartgrid svg{height:95px}
 #batalla-world .bw-chartgrid text{font-size:10px}
 #batalla-world .bw-caption{font-size:10px;line-height:1.65}
}
@media(prefers-reduced-motion:reduce){#batalla-world .bw-progress-fill{transition:none}}
''';p.write_text(s)
