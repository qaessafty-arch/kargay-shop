// Sets the WhatsApp message for the product that was clicked and counts the enquiry (no personal data is sent).
document.addEventListener('click', function (e) {
  var a = e.target.closest && e.target.closest('.ask');
  if (!a) return;
  var f = a.closest('figure');
  if (!f) return;
  var m = (a.getAttribute('href') || '').match(/wa\.me\/(\d+)/);
  if (!m) return;
  var im = f.querySelector('img');
  var u = '';
  var c = [f.getAttribute('data-full'), im && im.getAttribute('src'), f.getAttribute('data-extra')];
  for (var i = 0; i < c.length; i++) {
    if (c[i] && c[i].indexOf('http') == 0) { u = c[i]; break; }
    if (c[i] && c[i].charAt(0) == '/') { u = location.origin + c[i]; break; }
  }
  if (!u) u = location.origin + '/#' + f.id;
  var q = f.getAttribute('data-id');
  var L = window.LNG;
  var t = L == 'ar'
    ? 'مرحباً، أريد معرفة معلومات وسعر البلاط رقم ' + q
    : L == 'en'
      ? 'Hello, I would like information and the price of tile number ' + q
      : 'سڵاو، دەمەوێت زانیاری و نرخی کاشی ژمارە ' + q + (im && im.alt ? ' (' + im.alt + ')' : '') + ' بزانم';
  a.href = 'https://wa.me/' + m[1] + '?text=' + encodeURIComponent(t + '\n' + u);
  if (navigator.sendBeacon && q) {
    navigator.sendBeacon('/api/public/products/' + encodeURIComponent(q) + '/enquiry');
  }
}, true);
