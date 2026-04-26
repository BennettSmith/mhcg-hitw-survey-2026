export function fmtDmsSeconds(sec) {
  var t = sec.toFixed(2).replace(/\.?0+$/, "");
  return t === "" ? "0" : t;
}

export function decimalToDmsHemisphere(value, isLatitude) {
  var abs = Math.abs(value);
  var deg = Math.floor(abs + 1e-12);
  var minFloat = (abs - deg) * 60;
  var min = Math.floor(minFloat + 1e-12);
  var sec = (minFloat - min) * 60;
  var hemi = isLatitude
    ? value >= 0
      ? "N"
      : "S"
    : value >= 0
      ? "E"
      : "W";
  return deg + "°" + min + "'" + fmtDmsSeconds(sec) + '" ' + hemi;
}

export function buildCopyPayload(fmt, lat, lon) {
  var la = Number(lat);
  var lo = Number(lon);
  if (!isFinite(la) || !isFinite(lo)) {
    return "";
  }
  switch (fmt) {
    case "decimal":
      return la + ", " + lo;
    case "dms":
      return decimalToDmsHemisphere(la, true) + ", " + decimalToDmsHemisphere(lo, false);
    case "geo":
      return "geo:" + la + "," + lo;
    case "signed":
      return (la >= 0 ? "+" : "") + la + (lo >= 0 ? "+" : "") + lo;
    case "tab":
      return la + "\t" + lo;
    case "lines":
      return la + "\n" + lo;
    default:
      return "";
  }
}

export function buildGoogleEarthUrl(lat, lon) {
  var la = Number(lat);
  var lo = Number(lon);
  if (!isFinite(la) || !isFinite(lo)) {
    return "";
  }
  return "https://earth.google.com/web/search/" + encodeURIComponent(la + "," + lo);
}

export function photoMediaStatusMessage(p) {
  if (!p || p.kind !== "photo") {
    return "";
  }
  if (p.media_status === "missing") {
    return "This photo is listed in survey_photos.yaml, but the image file is missing from the deployed photos directory.";
  }
  if (p.media_status === "git_lfs_pointer") {
    return "This deployed file is a Git LFS pointer, not the real JPEG. Make sure Render fetches Git LFS objects or deploy the real photos another way.";
  }
  if (p.media_status === "invalid_filename") {
    return "This photo filename is not valid for the media route.";
  }
  return "";
}

export function createBaseLayers(L, topoAttribution, satelliteAttribution) {
  var topo = L.tileLayer("https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png", {
    maxZoom: 17,
    attribution: topoAttribution,
  });
  var sat = L.tileLayer(
    "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    {
      maxZoom: 18,
      attribution: satelliteAttribution,
    }
  );
  return { topo: topo, sat: sat };
}

export function setMapBasemap(map, layers, basemap) {
  if (!map || !layers) {
    return;
  }
  map.removeLayer(layers.topo);
  map.removeLayer(layers.sat);
  if (basemap === "sat") {
    layers.sat.addTo(map);
  } else {
    layers.topo.addTo(map);
  }
}

export function updateBasemapButton(btn, basemap) {
  if (!btn) {
    return;
  }
  var isSat = basemap === "sat";
  btn.textContent = isSat ? "Toggle to: Topo" : "Toggle to: Satelite";
  btn.setAttribute("aria-pressed", isSat ? "true" : "false");
  btn.title = isSat ? "Switch to topo basemap" : "Switch to satellite basemap";
}

export function elevationAtDistance(profileDist, profileEle, d) {
  if (!profileDist.length || profileDist.length !== profileEle.length) {
    return null;
  }
  if (d <= profileDist[0]) {
    return profileEle[0];
  }
  var dLast = profileDist[profileDist.length - 1];
  if (d >= dLast) {
    return profileEle[profileEle.length - 1];
  }
  for (var i = 0; i < profileDist.length - 1; i++) {
    var d0 = profileDist[i];
    var d1 = profileDist[i + 1];
    if (d >= d0 && d <= d1) {
      var t = (d - d0) / (d1 - d0 || 1e-12);
      var e0 = profileEle[i];
      var e1 = profileEle[i + 1];
      if (!isFinite(e0)) {
        e0 = e1;
      }
      if (!isFinite(e1)) {
        e1 = e0;
      }
      return e0 + t * (e1 - e0);
    }
  }
  return profileEle[0];
}

export function closestAlongTrackM(trackCoords, profileDist, lat, lon) {
  if (!trackCoords || trackCoords.length < 2 || !profileDist.length) {
    return 0;
  }
  var bestAlong = 0;
  var bestD2 = Infinity;
  var R = 6371000;
  var rad = Math.PI / 180;
  for (var i = 0; i < trackCoords.length - 1; i++) {
    var a = trackCoords[i];
    var b = trackCoords[i + 1];
    var d0 = profileDist[i];
    var segLen = profileDist[i + 1] - d0;
    if (segLen <= 0) {
      continue;
    }
    var lat0 = a[0];
    var lon0 = a[1];
    var bx = (b[1] - lon0) * rad * R * Math.cos(lat0 * rad);
    var by = (b[0] - lat0) * rad * R;
    var px = (lon - lon0) * rad * R * Math.cos(lat0 * rad);
    var py = (lat - lat0) * rad * R;
    var denom = bx * bx + by * by || 1e-12;
    var t = (px * bx + py * by) / denom;
    if (t < 0) {
      t = 0;
    } else if (t > 1) {
      t = 1;
    }
    var qx = bx * t;
    var qy = by * t;
    var dx = px - qx;
    var dy = py - qy;
    var d2 = dx * dx + dy * dy;
    if (d2 < bestD2) {
      bestD2 = d2;
      bestAlong = d0 + t * segLen;
    }
  }
  return bestAlong;
}

export function haversineMeters(lat1, lon1, lat2, lon2) {
  var R = 6371000;
  var rad = Math.PI / 180;
  var p1 = lat1 * rad;
  var p2 = lat2 * rad;
  var dphi = (lat2 - lat1) * rad;
  var dlmb = (lon2 - lon1) * rad;
  var h =
    Math.sin(dphi / 2) * Math.sin(dphi / 2) +
    Math.cos(p1) * Math.cos(p2) * Math.sin(dlmb / 2) * Math.sin(dlmb / 2);
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function trailElevationMForCoords(trackCoords, profileDist, profileEle, lat, lon) {
  if (
    !trackCoords.length ||
    trackCoords.length < 2 ||
    !profileDist.length ||
    profileDist.length !== profileEle.length
  ) {
    return null;
  }
  if (!isFinite(lat) || !isFinite(lon)) {
    return null;
  }
  var d = closestAlongTrackM(trackCoords, profileDist, lat, lon);
  var e = elevationAtDistance(profileDist, profileEle, d);
  if (e == null || !isFinite(e)) {
    return null;
  }
  return e;
}

export function drawElevationProfile(document, window, profileDist, profileEle, profileTotalM, alongM) {
  var canvas = document.getElementById("elevation-canvas");
  var wrap = document.querySelector(".elevation-wrap");
  if (!canvas || !wrap) {
    return;
  }
  var w = wrap.clientWidth;
  var h = wrap.clientHeight;
  if (w < 8 || h < 8) {
    return;
  }
  var dpr = window.devicePixelRatio || 1;
  canvas.width = Math.floor(w * dpr);
  canvas.height = Math.floor(h * dpr);
  canvas.style.width = w + "px";
  canvas.style.height = h + "px";
  var ctx = canvas.getContext("2d");
  if (!ctx) {
    return;
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  if (!profileDist.length || profileDist.length !== profileEle.length) {
    ctx.fillStyle = "#5c5852";
    ctx.font = "12px system-ui,sans-serif";
    ctx.fillText("No GPX profile", 10, 22);
    return;
  }
  var padL = 48;
  var padR = 8;
  var padT = 6;
  var padB = 24;
  var iw = w - padL - padR;
  var ih = h - padT - padB;
  var emin = Infinity;
  var emax = -Infinity;
  var j;
  for (j = 0; j < profileEle.length; j++) {
    var ev = profileEle[j];
    if (isFinite(ev)) {
      if (ev < emin) {
        emin = ev;
      }
      if (ev > emax) {
        emax = ev;
      }
    }
  }
  if (!(emin < emax)) {
    emin -= 10;
    emax += 10;
  } else {
    var epad = (emax - emin) * 0.06 || 3;
    emin -= epad;
    emax += epad;
  }
  var dmax = profileTotalM > 0 ? profileTotalM : profileDist[profileDist.length - 1] || 1;
  function xOf(dist) {
    return padL + (dist / dmax) * iw;
  }
  function yOf(elev) {
    return padT + ((emax - elev) / (emax - emin || 1)) * ih;
  }
  ctx.strokeStyle = "#d9d4cd";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(padL, padT);
  ctx.lineTo(padL, padT + ih);
  ctx.lineTo(padL + iw, padT + ih);
  ctx.stroke();
  ctx.strokeStyle = "#eceae6";
  ctx.lineWidth = 1;
  for (j = 1; j <= 3; j++) {
    var gy = padT + (ih * j) / 4;
    ctx.beginPath();
    ctx.moveTo(padL, gy);
    ctx.lineTo(padL + iw, gy);
    ctx.stroke();
  }
  var pts = [];
  for (j = 0; j < profileDist.length; j++) {
    if (!isFinite(profileEle[j])) {
      continue;
    }
    pts.push({
      x: xOf(profileDist[j]),
      y: yOf(profileEle[j]),
    });
  }
  if (pts.length < 2) {
    ctx.fillStyle = "#5c5852";
    ctx.font = "12px system-ui,sans-serif";
    ctx.fillText("Not enough elevation points", 10, 22);
    return;
  }
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (j = 1; j < pts.length; j++) {
    ctx.lineTo(pts[j].x, pts[j].y);
  }
  ctx.lineTo(pts[pts.length - 1].x, padT + ih);
  ctx.lineTo(pts[0].x, padT + ih);
  ctx.closePath();
  ctx.fillStyle = "rgba(47, 111, 122, 0.14)";
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (j = 1; j < pts.length; j++) {
    ctx.lineTo(pts[j].x, pts[j].y);
  }
  ctx.strokeStyle = "#2f6f7a";
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = "#5c5852";
  ctx.font = "11px system-ui, sans-serif";
  ctx.textAlign = "left";
  ctx.fillText("0", padL, padT + ih + 16);
  ctx.textAlign = "right";
  ctx.fillText((dmax / 1000).toFixed(1) + " km", padL + iw, padT + ih + 16);
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  ctx.fillText(Math.round(emax) + " m", padL - 6, padT + 8);
  ctx.fillText(Math.round(emin) + " m", padL - 6, padT + ih - 4);
  if (alongM != null && isFinite(alongM) && dmax > 0) {
    var clampD = Math.max(0, Math.min(alongM, dmax));
    var xe = xOf(clampD);
    var ee = elevationAtDistance(profileDist, profileEle, clampD);
    if (ee != null && isFinite(ee)) {
      var ye = yOf(ee);
      ctx.beginPath();
      ctx.strokeStyle = "rgba(232, 132, 26, 0.45)";
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 3]);
      ctx.moveTo(xe, padT);
      ctx.lineTo(xe, padT + ih);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.fillStyle = "#e8841a";
      ctx.strokeStyle = "#8a4b12";
      ctx.lineWidth = 2;
      ctx.arc(xe, ye, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }
}
