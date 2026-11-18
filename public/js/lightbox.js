(function(){var lb=document.getElementById("lb"),im=lb.querySelector("img"),cn=document.getElementById("lbc"),L=[],ix=0;
function fz(){if(im.naturalWidth){var r=(im.naturalWidth/im.naturalHeight)/(innerWidth/innerHeight);lb.classList.toggle("fit",!(r>0.7&&r<1.4))}}
function show(n){ix=(n+L.length)%L.length;im.src=L[ix].s;im.alt=L[ix].a;lb.classList.remove("fit");im.onload=fz;if(im.complete)fz();cn.textContent=(ix+1)+" / "+L.length;lb.classList.toggle("one",L.length<2)}
document.querySelector(".gallery").addEventListener("click",function(ev){var g=ev.target;if(!g||g.tagName!=="IMG")return;ev.preventDefault();var fg=g.closest("figure");L=[{s:fg.dataset.full||g.src,a:fg.dataset.fullAlt||g.alt}];if(fg.dataset.extra)L.push({s:fg.dataset.extra,a:fg.dataset.extraAlt||""});show(0);lb.classList.add("on");try{if(lb.requestFullscreen){var r=lb.requestFullscreen();if(r&&r.catch)r.catch(function(){})}}catch(e){}try{history.pushState({lb:1},"")}catch(e){}});
function cl(){if(lb.classList.contains("on")){lb.classList.remove("on");try{if(document.fullscreenElement)document.exitFullscreen()}catch(e){}if(history.state&&history.state.lb){try{history.back()}catch(e){}}}}
lb.addEventListener("click",function(e){var t=e.target;if(t.id==="lbn"){show(ix+1)}else if(t.id==="lbp"){show(ix-1)}else if(t.tagName==="IMG"){lb.classList.toggle("fit")}else{cl()}});
var x0=null;lb.addEventListener("touchstart",function(e){x0=e.touches.length===1?e.touches[0].clientX:null},{passive:true});
lb.addEventListener("touchend",function(e){if(x0===null||L.length<2)return;var dx=e.changedTouches[0].clientX-x0;x0=null;if(Math.abs(dx)>50){show(ix+(dx<0?1:-1))}},{passive:true});
document.addEventListener("fullscreenchange",function(){if(!document.fullscreenElement&&lb.classList.contains("on"))cl()});
window.addEventListener("popstate",function(){lb.classList.remove("on")});
document.addEventListener("keydown",function(e){if(e.key==="Escape")cl();else if(lb.classList.contains("on")&&L.length>1){if(e.key==="ArrowLeft")show(ix+1);if(e.key==="ArrowRight")show(ix-1)}})})();
