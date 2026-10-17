from pathlib import Path
p=Path('src/main.js');s=p.read_text()
s=s.replace("const camera=new T.PerspectiveCamera(45,1,1,24000),renderer=new T.WebGLRenderer({antialias:true,alpha:false});",'''const camera=new T.PerspectiveCamera(45,1,1,24000);let renderer,webgl=true,fallbackImage=null,fallbackContext;
try { renderer=new T.WebGLRenderer({antialias:true,alpha:false}); }
catch { webgl=false;const canvas=document.createElement('canvas');fallbackContext=canvas.getContext('2d');if(!fallbackContext)throw Error('This browser cannot display the race map.');renderer={domElement:canvas,capabilities:{getMaxAnisotropy:()=>1},setPixelRatio(){},setSize(w,h){canvas.width=w;canvas.height=h},render(){drawFallback()}};root.querySelectorAll('[data-camera="chase"],[data-camera="ride"]').forEach(b=>{b.disabled=true;b.setAttribute('title','3D camera requires WebGL')});root.querySelector('[data-camera="overview"]').textContent='Aerial map';root.querySelector('.bw-location').textContent='2D fallback · WebGL unavailable · select a rider to follow'; }
''')
s=s.replace("mat.map=texture;mat.needsUpdate=true;", "mat.map=texture;mat.needsUpdate=true;fallbackImage=texture.image;")
s=s.replace("$('bw-mode').textContent=mode==='overview'?'Serra de Tramuntana'", "$('bw-mode').textContent=mode==='overview'?(webgl?'Serra de Tramuntana':'Aerial map · 2D fallback')")
s=s.replace("$('bw-hud-detail').textContent=mode==='overview'?'Measured terrain · true vertical scale'", "$('bw-hud-detail').textContent=mode==='overview'?(webgl?'Measured terrain · true vertical scale':'WebGL unavailable in this browser')")
s=s.replace("el.style.display=(v.z>1", "el.style.display=(!webgl||v.z>1")
s=s.replace("charts();updateUI();requestAnimationFrame(frame);",'''function drawFallback(){
 const c=fallbackContext,w=renderer.domElement.width,h=renderer.domElement.height,scale=Math.min(w/width,h/depth)*Math.min(8,6200/radius),fx=mode==='free'?focus.x:0,fz=mode==='free'?focus.z:0;
 c.fillStyle='#18271f';c.fillRect(0,0,w,h);c.save();c.translate(w/2,h/2);c.scale(scale,scale);c.translate(-fx,-fz);if(fallbackImage)c.drawImage(fallbackImage,-width/2,-depth/2,width,depth);c.beginPath();road.forEach((p,i)=>i?c.lineTo(p[0],p[1]):c.moveTo(p[0],p[1]));c.strokeStyle='#ffed9f';c.lineWidth=2/scale;c.stroke();c.restore();
 riders.forEach((r,i)=>{let p=roadAt(distanceAt(i,time)),x=w/2+(p[0]-fx)*scale,y=h/2+(p[1]-fz)*scale;c.beginPath();c.arc(x,y,i===selected?10:8,0,Math.PI*2);c.fillStyle=cssColors[i];c.fill();c.fillStyle='#122018';c.font='500 11px system-ui';c.textAlign='center';c.fillText(String.fromCharCode(65+i),x,y+4)});
}
charts();updateUI();requestAnimationFrame(frame);''')
p.write_text(s)
