(function(){var G=document.querySelector('.gallery');if(!G)return;
var NUM='9647504251661',a0=document.querySelector('.ask');if(a0){var mm=(a0.getAttribute('href')||'').match(/wa\.me\/(\d+)/);if(mm)NUM=mm[1]}
function T(k,a,e){var l=window.LNG;return l=='ar'?a:l=='en'?e:k}
var st={q:'',s:'',t:''},BD='1px solid rgba(128,128,128,.4)',CS='border:'+BD+';background:transparent;color:inherit;border-radius:16px;padding:6px 12px;font:inherit;cursor:pointer;margin:3px',AC='',IS='width:100%;box-sizing:border-box;padding:10px 12px;border-radius:10px;border:'+BD+';background:transparent;color:inherit;font:inherit;margin:4px 0 12px';
function sz(f){var b=f.querySelector('b'),m=b&&b.textContent.match(/(\d+)\s*[×x]\s*(\d+)/);return m?m[1]+'×'+m[2]:''}
function ty(f){if(f._t)return f._t;var a=(f.querySelector('img')||{}).alt||'';return f._t=/ڕەسیف/.test(a)?'curb':(/گوڵدان|کورسی/.test(a)||a.indexOf('پارچە')==0)?'decor':'tile'}
function area(s){var m=s.split('×');return (+m[0])*(+m[1])}
function sizes(){var o={};G.querySelectorAll('figure').forEach(function(f){var s=sz(f);if(s)o[s]=1});return Object.keys(o).sort(function(a,b){return area(b)-area(a)})}
var bar=document.createElement('div'),inp=document.createElement('input'),c1=document.createElement('div'),c2=document.createElement('div'),cn=document.createElement('div');
inp.type='search';inp.className='gf-input gf-search';inp.oninput=function(){st.q=inp.value.trim().toLowerCase();flt()};
cn.className='gf-count';bar.className='gf-bar';c1.className=c2.className='gf-chips';bar.appendChild(inp);bar.appendChild(c1);bar.appendChild(c2);bar.appendChild(cn);G.parentNode.insertBefore(bar,G);
function chip(t,on,fn){var b=document.createElement('button');b.textContent=t;b.type='button';b.className='gf-chip'+(on?' is-on':'');b.setAttribute('aria-pressed',on?'true':'false');b.onclick=fn;return b}
function flt(){bar.dir=window.LNG=='en'?'ltr':'rtl';inp.placeholder=T('گەڕان لەناو کاشییەکان...','ابحث في البلاطات...','Search tiles...');
function nq(t){return String(t).toLowerCase().replace(/[\u0660-\u0669]/g,function(c){return c.charCodeAt(0)-1632}).replace(/[\u06F0-\u06F9]/g,function(c){return c.charCodeAt(0)-1776}).replace(/\u064A|\u0649/g,'\u06CC').replace(/\u0643/g,'\u06A9').replace(/[\u00D7*xX\u0425\u0445]/g,'x').replace(/[\u064B-\u065F\u0640\u200C\u200D]/g,'').replace(/\s+/g,'')}
var fs=G.querySelectorAll('figure'),n=0;fs.forEach(function(f){var s=sz(f),ok=(!st.s||(st.s=='-'?!s:s==st.s))&&(!st.t||ty(f)==st.t)&&(!st.q||nq(((f.textContent||'')+' '+((f.querySelector('img')||{}).alt||''))).indexOf(nq(st.q))>-1);f.style.display=ok?'':'none';if(ok)n++});
c1.innerHTML='';c2.innerHTML='';
c1.appendChild(chip(T('هەموو','الكل','All'),!st.t,function(){st.t='';flt()}));
[['tile',T('کاشی','بلاط','Tiles')],['curb',T('ڕەسیف','رصيف','Curbs')],['decor',T('گوڵدان و ڕازاندنەوە','أصص وزينة','Pots & decor')]].forEach(function(x){c1.appendChild(chip(x[1],st.t==x[0],function(){st.t=st.t==x[0]?'':x[0];flt()}))});
c2.appendChild(chip(T('هەموو قەبارە','كل المقاسات','All sizes'),!st.s,function(){st.s='';flt()}));
sizes().forEach(function(s){c2.appendChild(chip(s.replace('×',' × '),st.s==s,function(){st.s=st.s==s?'':s;flt()}))});
cn.textContent=n+' / '+fs.length}
var cb=document.createElement('div');cb.className='gf-calc';
var h=document.createElement('h3'),l1=document.createElement('label'),i1=document.createElement('input'),l2=document.createElement('label'),i2=document.createElement('input'),l3=document.createElement('label'),s3=document.createElement('select'),l4=document.createElement('label'),s4=document.createElement('select'),rs=document.createElement('div'),wa=document.createElement('a');
h.className='gf-calc-title';[l1,l2,l3,l4].forEach(function(l){l.className='gf-label'});[i1,i2].forEach(function(i){i.type='text';i.setAttribute('inputmode','decimal');i.className='gf-input';i.oninput=cal});[s3,s4].forEach(function(s){s.className='gf-input';s.onchange=cal});
[0,5,10,15].forEach(function(w){var o=document.createElement('option');o.value=w;o.textContent=w+'%';if(w==10)o.selected=true;s4.appendChild(o)});
rs.className='gf-result';wa.target='_blank';wa.rel='noopener';wa.className='gf-wa';wa.style.display='none';
[h,l1,i1,l2,i2,l3,s3,l4,s4,rs,wa].forEach(function(e){cb.appendChild(e)});G.parentNode.insertBefore(cb,G.nextSibling);
function num(v){v=String(v).replace(/[٠-٩]/g,function(d){return '٠١٢٣٤٥٦٧٨٩'.indexOf(d)}).replace(/[۰-۹]/g,function(d){return '۰۱۲۳۴۵۶۷۸۹'.indexOf(d)}).replace('٫','.').replace(',','.');return parseFloat(v)}
var R=null;
function cal(){var L=num(i1.value),W=num(i2.value),s=s3.value;if(!(L>0&&W>0)||!s){rs.textContent='';wa.style.display='none';return}
var p=area(s)/10000,w=+s4.value,ar=L*W,n=Math.ceil(ar*(1+w/100)/p),sc=s.replace('×',' × ');
rs.textContent=T('ڕووبەر: ','المساحة: ','Area: ')+ar.toFixed(1)+T(' م² · پێویستت بە ',' م² · تحتاج ',' m² · You need ')+n+T(' پارچەیە',' قطعة',' pieces');
var msg=T('سڵاو، دەمەوێت کاشی بکڕم. ڕووبەر: '+ar.toFixed(1)+' م² ('+L+' × '+W+' م). قەبارەی کاشی: '+sc+' سم. ژمارەی پێویست (لەگەڵ '+w+'% زیادە): '+n+' پارچە. نرخی دەوێت.','مرحباً، أريد شراء بلاط. المساحة: '+ar.toFixed(1)+' م² ('+L+' × '+W+' م). مقاس البلاط: '+sc+' سم. العدد المطلوب (مع '+w+'% زيادة): '+n+' قطعة. أريد معرفة السعر.','Hello, I want to buy tiles. Area: '+ar.toFixed(1)+' m² ('+L+' × '+W+' m). Tile size: '+sc+' cm. Pieces needed (with '+w+'% extra): '+n+'. Please send the price.');
wa.href='https://wa.me/'+NUM+'?text='+encodeURIComponent(msg);wa.style.display='block';wa.textContent=T('ناردن بۆ واتسئاپ','إرسال عبر واتساب','Send on WhatsApp')}
function bld(){cb.dir=window.LNG=='en'?'ltr':'rtl';h.textContent=T('ژمێرەری کاشی','حاسبة البلاط','Tile calculator');
l1.textContent=T('درێژی شوێن (مەتر)','طول المكان (متر)','Length (meters)');l2.textContent=T('پانی شوێن (مەتر)','عرض المكان (متر)','Width (meters)');l3.textContent=T('قەبارەی کاشی (سم)','مقاس البلاط (سم)','Tile size (cm)');l4.textContent=T('زیادە بۆ بڕین و شکان','نسبة إضافية للقص والكسر','Extra for cuts and breakage');
var cur=s3.value,ss=sizes();if(!ss.length)ss=['40×40'];s3.innerHTML='';ss.forEach(function(s){var o=document.createElement('option');o.value=s;o.textContent=s.replace('×',' × ');s3.appendChild(o)});if(cur&&ss.indexOf(cur)>-1)s3.value=cur;cal()}
function all(){flt();bld()}
window.onlng=all;all();setTimeout(all,1500);
new MutationObserver(function(){clearTimeout(window._ft);window._ft=setTimeout(all,300)}).observe(G,{childList:true});
})();
