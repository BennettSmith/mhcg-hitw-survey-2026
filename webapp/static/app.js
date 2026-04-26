export {
  buildCopyPayload,
  buildGoogleEarthUrl,
  decimalToDmsHemisphere,
  fmtDmsSeconds,
} from "./app-helpers.js";

import {
  buildCopyPayload,
  buildGoogleEarthUrl,
  closestAlongTrackM,
  createBaseLayers,
  drawElevationProfile,
  elevationAtDistance,
  haversineMeters,
  photoMediaStatusMessage,
  setMapBasemap,
  trailElevationMForCoords,
  updateBasemapButton,
} from "./app-helpers.js";

export function initSurveyApp(options) {
  options = options || {};
  var window = options.window || globalThis.window;
  var document = options.document || window.document;
  var navigator = options.navigator || window.navigator;
  var localStorage = options.localStorage || window.localStorage;
  var requestAnimationFrame = options.requestAnimationFrame || window.requestAnimationFrame.bind(window);
  var setTimeout = options.setTimeout || window.setTimeout.bind(window);
  var clearTimeout = options.clearTimeout || window.clearTimeout.bind(window);
  var fetch = options.fetch || globalThis.fetch.bind(globalThis);
  var ResizeObserver = options.ResizeObserver || globalThis.ResizeObserver;
  var L = options.leaflet || globalThis.L;

        const listPhotosEl = document.getElementById("list-photos");
        const listPinsEl = document.getElementById("list-pins");
        const listPanel = document.getElementById("list-panel");
        const searchEl = document.getElementById("search");
        const photoEl = document.getElementById("photo");
        const photoLoadingEl = document.getElementById("photo-loading");
        const photoErrorEl = document.getElementById("photo-error");
        const photoLightboxEl = document.getElementById("photo-lightbox");
        const photoLightboxStageEl = document.getElementById("photo-lightbox-stage");
        const photoLightboxImgEl = document.getElementById("photo-lightbox-img");
        const photoBasemapBtn = document.getElementById("basemap-photo-btn");
        const trackBasemapBtn = document.getElementById("basemap-track-btn");
        const metaEl = document.getElementById("meta-block");
        const countLabel = document.getElementById("count-label");
        const mainEl = document.getElementById("main");
        const emptyEl = document.getElementById("empty");

        const ATTRIB_OTM =
          'Map: © <a href="https://opentopomap.org">OpenTopoMap</a> ' +
          '(<a href="https://creativecommons.org/licenses/by-sa/3.0/">CC-BY-SA</a>) ' +
          '· Data: © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';
        const ATTRIB_SAT =
          'Imagery © <a href="https://www.esri.com/">Esri</a> · Source: Esri, Maxar, Earthstar Geographics';

        const COPY_FMT_STORAGE_KEY = "mhcgHitwSurveyCopyCoordFmt";
        const COPY_FMT_OPTIONS = [
          ["decimal", "Decimal (lat, lon)"],
          ["dms", "DMS (hemisphere)"],
          ["geo", "Geo URI"],
          ["signed", "Signed compact"],
          ["tab", "Tab-separated (spreadsheet)"],
          ["lines", "Two lines (lat then lon)"],
        ];

        let photos = [];
        let pinList = [];
        let photosFiltered = [];
        let pinsFiltered = [];
        let selected = null;
        let trackCoords = [];
        let profileDist = [];
        let profileEle = [];
        let profileTotalM = 0;
        var lastElevationAlongM = null;
        let trackMap = null;
        let photoMap = null;
        let trackLine = null;
        let photoTrackLine = null;
        let trackMarker = null;
        let photoMarker = null;
        let pinMarkersLayer = null;
        let trackBaseLayers = null;
        let photoBaseLayers = null;
        let activePinIndex = null;
        const PHOTO_MAP_DEFAULT_ZOOM = 17;
        let trackBasemap = "sat";
        let photoBasemap = "sat";
        let notesReadOnly = false;
        var lightboxOpen = false;
        var lightboxBaseScale = 1;
        var lightboxScale = 1;
        var lightboxPanX = 0;
        var lightboxPanY = 0;
        var lightboxDragging = false;
        var lightboxDragStartX = 0;
        var lightboxDragStartY = 0;
        var lightboxStartPanX = 0;
        var lightboxStartPanY = 0;

        var notesDebounceTimer = null;
        var notesStatusClearTimer = null;

        function setNotesStatus(msg, isOk) {
          var el = document.getElementById("photo-notes-status");
          if (!el) {
            return;
          }
          el.textContent = msg || "";
          el.className = "notes-status";
          if (msg && isOk === true) {
            el.classList.add("ok");
          }
          if (msg && isOk === false) {
            el.classList.add("err");
          }
          if (notesStatusClearTimer) {
            clearTimeout(notesStatusClearTimer);
          }
          if (msg) {
            notesStatusClearTimer = setTimeout(function () {
              el.textContent = "";
              el.className = "notes-status";
            }, 2200);
          }
        }

        function scheduleNotesDebouncedSave() {
          if (notesDebounceTimer) {
            clearTimeout(notesDebounceTimer);
          }
          notesDebounceTimer = setTimeout(function () {
            notesDebounceTimer = null;
            void persistNotesForCurrentSelection();
          }, 650);
        }

        function persistNotesForCurrentSelection() {
          if (!selected || selected.kind !== "photo" || notesReadOnly) {
            return Promise.resolve();
          }
          var ta = document.getElementById("photo-notes");
          if (!ta) {
            return Promise.resolve();
          }
          var v = ta.value;
          var prev = selected.notes == null ? "" : String(selected.notes);
          if (v === prev) {
            return Promise.resolve();
          }
          setNotesStatus("Saving…", null);
          return fetch(
            "/api/photos/" + encodeURIComponent(selected.filename) + "/notes",
            {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ notes: v }),
            }
          )
            .then(function (r) {
              if (!r.ok) {
                throw new Error(r.statusText);
              }
              return r.json();
            })
            .then(function () {
              selected.notes = v;
              setNotesStatus("Saved", true);
            })
            .catch(function () {
              setNotesStatus("Save failed", false);
            });
        }

        function syncNotesFromSelection() {
          var ta = document.getElementById("photo-notes");
          if (!ta || !selected) {
            return;
          }
          if (selected.kind === "pin") {
            ta.value = "";
            ta.disabled = true;
            ta.readOnly = false;
            ta.placeholder = "Notes are saved only for survey photos (YAML).";
            setNotesStatus("", null);
            return;
          }
          ta.disabled = false;
          ta.readOnly = notesReadOnly;
          ta.placeholder = notesReadOnly
            ? "Notes are read-only in this deployment."
            : "Observations for this spot (saved to survey_photos.yaml)…";
          ta.value = selected.notes == null ? "" : String(selected.notes);
          setNotesStatus(notesReadOnly ? "Read-only" : "", notesReadOnly ? true : null);
        }

        function esc(s) {
          const d = document.createElement("div");
          d.textContent = s;
          return d.innerHTML;
        }

        function applyLightboxTransform() {
          if (!photoLightboxImgEl) {
            return;
          }
          var effectiveScale = lightboxBaseScale * lightboxScale;
          photoLightboxImgEl.style.transform =
            "translate(" +
            lightboxPanX +
            "px, " +
            lightboxPanY +
            "px) translate(-50%, -50%) scale(" +
            effectiveScale +
            ")";
        }

        function updateLightboxBaseScale() {
          if (!photoLightboxStageEl || !photoLightboxImgEl) {
            return;
          }
          var iw = photoLightboxImgEl.naturalWidth || 0;
          var ih = photoLightboxImgEl.naturalHeight || 0;
          var sw = photoLightboxStageEl.clientWidth || 0;
          var sh = photoLightboxStageEl.clientHeight || 0;
          if (!iw || !ih || !sw || !sh) {
            lightboxBaseScale = 1;
            return;
          }
          lightboxBaseScale = Math.min(sw / iw, sh / ih, 1);
        }

        function resetLightboxView() {
          updateLightboxBaseScale();
          lightboxScale = 1;
          lightboxPanX = 0;
          lightboxPanY = 0;
          applyLightboxTransform();
        }

        function closePhotoLightbox() {
          if (!photoLightboxEl || !lightboxOpen) {
            return;
          }
          lightboxOpen = false;
          lightboxDragging = false;
          if (photoLightboxStageEl) {
            photoLightboxStageEl.classList.remove("is-dragging");
          }
          photoLightboxEl.hidden = true;
          photoLightboxEl.setAttribute("aria-hidden", "true");
        }

        function openPhotoLightbox() {
          if (
            !photoLightboxEl ||
            !photoLightboxImgEl ||
            !selected ||
            selected.kind !== "photo" ||
            !photoEl ||
            !photoEl.src
          ) {
            return;
          }
          photoLightboxImgEl.src = photoEl.src;
          photoLightboxImgEl.alt = photoEl.alt || selected.filename || "Photo";
          lightboxOpen = true;
          photoLightboxEl.hidden = false;
          photoLightboxEl.setAttribute("aria-hidden", "false");
          if (photoLightboxImgEl.complete) {
            resetLightboxView();
          } else {
            photoLightboxImgEl.onload = function () {
              resetLightboxView();
            };
          }
        }

        function wrapPhoto(p) {
          return {
            kind: "photo",
            filename: p.filename,
            taken_at: p.taken_at || "",
            latitude: p.latitude,
            longitude: p.longitude,
            notes: p.notes,
            media_url: p.media_url || "",
            media_status: p.media_status || "unknown",
            media_bytes: p.media_bytes || 0,
          };
        }

        function wrapPin(w) {
          return {
            kind: "pin",
            pin_index: w.pin_index,
            name: w.name,
            taken_at: w.taken_at || "",
            latitude: w.latitude,
            longitude: w.longitude,
            elevation_m: w.elevation_m,
          };
        }

        function setPhotoPanelMode(isPin) {
          var wrap = document.getElementById("photo-wrap");
          var nameEl = document.getElementById("photo-pin-name");
          var photoTitle = document.querySelector(".photo-card > h2");
          var mapPhotoTitle = document.getElementById("map-photo-title-text");
          if (wrap) {
            wrap.classList.toggle("pin-mode", !!isPin);
          }
          if (nameEl && selected && selected.kind === "pin") {
            nameEl.textContent = selected.name || "";
          }
          if (photoTitle) {
            photoTitle.textContent = isPin ? "Ranger waypoint" : "Photo";
          }
          if (mapPhotoTitle) {
            mapPhotoTitle.textContent = isPin ? "Waypoint location" : "Photo location";
          }
        }

function showPhotoError(message) {
          if (!photoErrorEl) {
            return;
          }
          photoErrorEl.textContent = message;
          photoErrorEl.hidden = !message;
        }

        function showPhotoLoading(show) {
          if (!photoLoadingEl) {
            return;
          }
          photoLoadingEl.hidden = !show;
        }

        function getStoredCopyFmt() {
          try {
            var v = localStorage.getItem(COPY_FMT_STORAGE_KEY);
            if (v && COPY_FMT_OPTIONS.some(function (o) { return o[0] === v; })) {
              return v;
            }
          } catch (e) {}
          return "decimal";
        }

        function persistCopyFmt(value) {
          try {
            if (COPY_FMT_OPTIONS.some(function (o) { return o[0] === value; })) {
              localStorage.setItem(COPY_FMT_STORAGE_KEY, value);
            }
          } catch (e) {}
        }

        function copyToClipboard(text) {
          if (!text) {
            return Promise.reject();
          }
          if (navigator.clipboard && navigator.clipboard.writeText) {
            return navigator.clipboard.writeText(text);
          }
          return new Promise(function (resolve, reject) {
            var ta = document.createElement("textarea");
            ta.value = text;
            ta.setAttribute("readonly", "");
            ta.style.position = "fixed";
            ta.style.left = "-9999px";
            document.body.appendChild(ta);
            ta.select();
            try {
              document.execCommand("copy");
              resolve();
            } catch (err) {
              reject(err);
            } finally {
              document.body.removeChild(ta);
            }
          });
        }

        function renderMeta(p) {
          var storedFmt = getStoredCopyFmt();
          var optionsHtml = COPY_FMT_OPTIONS.map(function (pair) {
            var id = pair[0];
            var sel = id === storedFmt ? ' selected="selected"' : "";
            return '<option value="' + id + '"' + sel + ">" + esc(pair[1]) + "</option>";
          }).join("");
          var latN = Number(p.latitude);
          var lonN = Number(p.longitude);
          var trailElev = trailElevationMForCoords(trackCoords, profileDist, profileEle, latN, lonN);
          if (p.kind === "pin") {
            var gpxEl = p.elevation_m;
            var elevDd;
            if (gpxEl != null && isFinite(Number(gpxEl))) {
              elevDd =
                '<dd title="Elevation from the waypoint in MHCG-HITW-PINS.gpx.">' +
                esc(String(Math.round(Number(gpxEl)))) +
                " m</dd>";
            } else if (trailElev != null && isFinite(trailElev)) {
              elevDd =
                '<dd title="Interpolated from the hike GPX at the closest point on the trail.">' +
                esc(String(Math.round(trailElev))) +
                " m</dd>";
            } else {
              elevDd = "<dd>—</dd>";
            }
            metaEl.innerHTML =
              "<dl>" +
              "<dt>Type</dt><dd>Ranger waypoint</dd>" +
              "<dt>Label</dt><dd>" +
              esc(p.name || "") +
              "</dd>" +
              "<dt>Time</dt><dd>" +
              esc(p.taken_at || "—") +
              "</dd>" +
              "<dt>Latitude</dt><dd>" +
              esc(String(p.latitude)) +
              "</dd>" +
              "<dt>Longitude</dt><dd>" +
              '<span class="lon-num">' +
              esc(String(p.longitude)) +
              '</span><span class="copy-row">' +
              '<select id="copy-fmt-select" aria-label="Coordinate format for copy">' +
              optionsHtml +
              "</select>" +
              '<button type="button" id="copy-coords-btn" title="Copy coordinates in the selected format">Copy</button>' +
              '<button type="button" id="open-earth-btn" title="Open this location in Google Earth">Earth</button>' +
              "</span></dd>" +
              "<dt>Elevation</dt>" +
              elevDd +
              "</dl>";
            return;
          }
          var elevDdPhoto =
            trailElev != null && isFinite(trailElev)
              ? '<dd title="Interpolated from survey GPX at the closest point on the trail to this photo’s coordinates.">' +
                esc(String(Math.round(trailElev))) +
                " m</dd>"
              : '<dd title="Load the hike GPX or ensure coordinates lie near the track.">—</dd>';
          metaEl.innerHTML =
            "<dl>" +
            "<dt>Filename</dt><dd>" +
            esc(p.filename) +
            "</dd>" +
            "<dt>Taken</dt><dd>" +
            esc(p.taken_at) +
            "</dd>" +
            "<dt>Latitude</dt><dd>" +
            esc(String(p.latitude)) +
            "</dd>" +
            "<dt>Longitude</dt><dd>" +
            '<span class="lon-num">' +
            esc(String(p.longitude)) +
            '</span><span class="copy-row">' +
            '<select id="copy-fmt-select" aria-label="Coordinate format for copy">' +
            optionsHtml +
            "</select>" +
            '<button type="button" id="copy-coords-btn" title="Copy coordinates in the selected format">Copy</button>' +
            '<button type="button" id="open-earth-btn" title="Open this photo location in Google Earth">Earth</button>' +
            "</span></dd>" +
            "<dt>Elevation</dt>" +
            elevDdPhoto +
            "</dl>";
        }

        metaEl.addEventListener("change", function (e) {
          if (e.target.id !== "copy-fmt-select") {
            return;
          }
          persistCopyFmt(e.target.value);
        });

        metaEl.addEventListener("click", function (e) {
          var btn = e.target.closest("#copy-coords-btn");
          if (!btn || !metaEl.contains(btn)) {
            return;
          }
          if (!selected) {
            return;
          }
          var sel = metaEl.querySelector("#copy-fmt-select");
          var fmt = sel ? sel.value : getStoredCopyFmt();
          var text = buildCopyPayload(fmt, selected.latitude, selected.longitude);
          copyToClipboard(text).then(
            function () {
              btn.classList.add("was-copied");
              window.setTimeout(function () {
                btn.classList.remove("was-copied");
              }, 1400);
            },
            function () {
              window.alert("Could not copy to the clipboard.");
            }
          );
        });

        metaEl.addEventListener("click", function (e) {
          var btn = e.target.closest("#open-earth-btn");
          if (!btn || !metaEl.contains(btn) || !selected) {
            return;
          }
          var url = buildGoogleEarthUrl(selected.latitude, selected.longitude);
          if (!url) {
            window.alert("Could not open Google Earth for this location.");
            return;
          }
          var earthWindow = window.open(url, "mhcg-google-earth");
          if (earthWindow && earthWindow.focus) {
            earthWindow.focus();
          }
        });

function updateBasemapButtons() {
          updateBasemapButton(trackBasemapBtn, trackBasemap);
          updateBasemapButton(photoBasemapBtn, photoBasemap);
        }

        function toggleTrackBasemap() {
          trackBasemap = trackBasemap === "sat" ? "topo" : "sat";
          updateBasemapButton(trackBasemapBtn, trackBasemap);
          if (trackMap && trackBaseLayers) {
            setMapBasemap(trackMap, trackBaseLayers, trackBasemap);
          }
        }

        function togglePhotoBasemap() {
          photoBasemap = photoBasemap === "sat" ? "topo" : "sat";
          updateBasemapButton(photoBasemapBtn, photoBasemap);
          if (photoMap && photoBaseLayers) {
            setMapBasemap(photoMap, photoBaseLayers, photoBasemap);
          }
        }

        function destroyMaps() {
          if (trackMap) {
            trackMap.remove();
            trackMap = null;
          }
          if (photoMap) {
            photoMap.remove();
            photoMap = null;
          }
          trackLine = null;
          photoTrackLine = null;
          trackMarker = null;
          photoMarker = null;
          pinMarkersLayer = null;
          trackBaseLayers = null;
          photoBaseLayers = null;
        }

        function invalidateMaps() {
          if (trackMap) {
            trackMap.invalidateSize();
          }
          if (photoMap) {
            photoMap.invalidateSize();
          }
          drawElevationProfile(document, window, profileDist, profileEle, profileTotalM, lastElevationAlongM);
        }

        function recenterTrackMap() {
          if (!trackMap) {
            return;
          }
          if (trackLine) {
            trackMap.fitBounds(trackLine.getBounds(), {
              padding: [28, 28],
              maxZoom: 15,
            });
          } else {
            trackMap.setView([35.08, -115.42], 12);
          }
        }

        function recenterPhotoMap() {
          if (!photoMap || !selected) {
            return;
          }
          var lat = Number(selected.latitude);
          var lon = Number(selected.longitude);
          if (!isFinite(lat) || !isFinite(lon)) {
            return;
          }
          photoMap.setView([lat, lon], PHOTO_MAP_DEFAULT_ZOOM, { animate: true });
        }

        function changeLightboxZoom(mult) {
          var next = lightboxScale * mult;
          lightboxScale = Math.max(1, Math.min(10, next));
          if (lightboxScale <= 1.01) {
            lightboxPanX = 0;
            lightboxPanY = 0;
          }
          applyLightboxTransform();
        }

        /** Max horizontal distance (m) from the selected item for pins on the survey map. */
        var PIN_PROXIMITY_RADIUS_M = 280;
        var rangerPinIcon = L.divIcon({
          className: "ranger-pin-icon",
          html: '<div class="ranger-pin-triangle" aria-hidden="true"></div>',
          iconSize: [18, 18],
          iconAnchor: [9, 18],
          popupAnchor: [0, -18],
        });

function refreshPinsNearSelection() {
          if (!pinMarkersLayer) {
            return;
          }
          pinMarkersLayer.clearLayers();
          if (!selected) {
            return;
          }
          var rlat = Number(selected.latitude);
          var rlon = Number(selected.longitude);
          if (!isFinite(rlat) || !isFinite(rlon)) {
            return;
          }
          pinList.forEach(function (w) {
            var d = haversineMeters(rlat, rlon, w.latitude, w.longitude);
            if (d <= PIN_PROXIMITY_RADIUS_M) {
              L.marker([w.latitude, w.longitude], {
                icon: rangerPinIcon,
                title: w.name || "Ranger pin",
              })
                .bindPopup(esc(w.name), { maxWidth: 300 })
                .addTo(pinMarkersLayer);
            }
          });
        }

        function scrollNearbyPinsIntoView() {
          if (!selected || selected.kind !== "photo" || !listPinsEl) {
            return;
          }
          var plat = Number(selected.latitude);
          var plon = Number(selected.longitude);
          if (!isFinite(plat) || !isFinite(plon)) {
            return;
          }
          var closestIdx = null;
          var closestD = Infinity;
          pinsFiltered.forEach(function (w) {
            var d = haversineMeters(plat, plon, w.latitude, w.longitude);
            if (d <= PIN_PROXIMITY_RADIUS_M && d < closestD) {
              closestD = d;
              closestIdx = w.pin_index;
            }
          });
          if (closestIdx == null) {
            return;
          }
          var li = listPinsEl.querySelector(
            'li[data-pin-index="' + closestIdx + '"]'
          );
          if (li) {
            li.scrollIntoView({ block: "nearest", behavior: "smooth" });
          }
        }

        /** Nearest photo to lat/lon (filtered set when available, else full photo set). */
        function closestPhotoFilenameForCoords(lat, lon) {
          var lf = Number(lat);
          var ln = Number(lon);
          var candidatePhotos = photosFiltered.length ? photosFiltered : photos;
          if (!isFinite(lf) || !isFinite(ln) || !candidatePhotos.length) {
            return null;
          }
          var bestName = null;
          var bestD = Infinity;
          candidatePhotos.forEach(function (p) {
            var d = haversineMeters(
              lf,
              ln,
              Number(p.latitude),
              Number(p.longitude)
            );
            if (d < bestD) {
              bestD = d;
              bestName = p.filename;
            }
          });
          return bestName;
        }

        function scrollPartnerPhotoIntoView() {
          if (!selected || selected.kind !== "pin" || !listPhotosEl) {
            return;
          }
          var fn = closestPhotoFilenameForCoords(
            Number(selected.latitude),
            Number(selected.longitude)
          );
          if (!fn) {
            return;
          }
          var lis = listPhotosEl.querySelectorAll("li");
          var i;
          for (i = 0; i < lis.length; i++) {
            if (lis[i].dataset.photoFilename === fn) {
              lis[i].scrollIntoView({ block: "nearest", behavior: "smooth" });
              return;
            }
          }
        }

        function renderPhotoList() {
          if (!listPhotosEl) {
            return;
          }
          listPhotosEl.innerHTML = "";
          var partnerFn = null;
          if (selected && selected.kind === "pin") {
            partnerFn = closestPhotoFilenameForCoords(
              Number(selected.latitude),
              Number(selected.longitude)
            );
          }
          photosFiltered.forEach(function (p, i) {
            var li = document.createElement("li");
            var sel =
              selected &&
              selected.kind === "photo" &&
              selected.filename === p.filename;
            var fromPin =
              partnerFn != null &&
              partnerFn === p.filename &&
              selected &&
              selected.kind === "pin";
            li.classList.toggle("is-selected", !!sel);
            li.classList.toggle("is-selected-from-pin", !!fromPin);
            li.dataset.photoFilename = p.filename;
            li.dataset.entryId = "p:" + p.filename;
            var btn = document.createElement("button");
            btn.type = "button";
            btn.innerHTML =
              '<div class="li-title">' +
              esc(p.filename) +
              '</div><div class="li-meta">' +
              esc(p.taken_at || "") +
              "</div>";
            btn.addEventListener("click", function () {
              void selectPhotoByIndex(i).catch(function () {});
            });
            li.appendChild(btn);
            listPhotosEl.appendChild(li);
          });
        }

        function renderPinList() {
          if (!listPinsEl) {
            return;
          }
          listPinsEl.innerHTML = "";
          var plat =
            selected && selected.kind === "photo"
              ? Number(selected.latitude)
              : NaN;
          var plon =
            selected && selected.kind === "photo"
              ? Number(selected.longitude)
              : NaN;
          var hasPhotoRef =
            selected &&
            selected.kind === "photo" &&
            isFinite(plat) &&
            isFinite(plon);
          pinsFiltered.forEach(function (w, i) {
            var li = document.createElement("li");
            li.classList.add("is-pin");
            li.dataset.entryId = "w:" + w.pin_index;
            li.dataset.pinIndex = String(w.pin_index);
            var selPin = activePinIndex != null && activePinIndex === w.pin_index;
            li.classList.toggle("is-selected", !!selPin);
            var near =
              hasPhotoRef &&
              haversineMeters(plat, plon, w.latitude, w.longitude) <=
                PIN_PROXIMITY_RADIUS_M;
            li.classList.toggle("is-nearby", !!near && !selPin);
            var btn = document.createElement("button");
            btn.type = "button";
            btn.innerHTML =
              '<div class="li-title">' +
              esc(w.name) +
              '</div><div class="li-meta">Ranger pin · ' +
              esc(w.taken_at || "—") +
              "</div>";
            btn.addEventListener("click", function () {
              void selectPinByIndex(i).catch(function () {});
            });
            li.appendChild(btn);
            listPinsEl.appendChild(li);
          });
        }

        /** Elevation (m) from GPX at the trail point nearest lat/lon, or null if unavailable. */
function updateElevationForSelection(lat, lon) {
          if (
            !trackCoords.length ||
            !profileDist.length ||
            profileDist.length !== profileEle.length
          ) {
            lastElevationAlongM = null;
            drawElevationProfile(document, window, profileDist, profileEle, profileTotalM, null);
            return;
          }
          var d = closestAlongTrackM(trackCoords, profileDist, lat, lon);
          lastElevationAlongM = d;
          drawElevationProfile(document, window, profileDist, profileEle, profileTotalM, d);
        }

function ensureMaps() {
          if (trackMap && photoMap) {
            return;
          }
          destroyMaps();
          trackMap = L.map("map-track", { zoomControl: true });
          trackBaseLayers = createBaseLayers(L, ATTRIB_OTM, ATTRIB_SAT);
          setMapBasemap(trackMap, trackBaseLayers, trackBasemap);
          photoMap = L.map("map-photo", { zoomControl: true });
          photoBaseLayers = createBaseLayers(L, ATTRIB_OTM, ATTRIB_SAT);
          setMapBasemap(photoMap, photoBaseLayers, photoBasemap);

          if (trackCoords.length >= 2) {
            photoTrackLine = L.polyline(trackCoords, {
              color: "#2f6f7a",
              weight: 3,
              opacity: 0.75,
            }).addTo(photoMap);
          }

          trackMarker = L.circleMarker([0, 0], {
            radius: 9,
            color: "#1c4f57",
            weight: 2,
            fillColor: "#2f6f7a",
            fillOpacity: 0.95,
          }).addTo(trackMap);

          photoMarker = L.circleMarker([0, 0], {
            radius: 10,
            color: "#1c4f57",
            weight: 2,
            fillColor: "#2f6f7a",
            fillOpacity: 0.95,
          }).addTo(photoMap);

          if (trackCoords.length >= 2) {
            trackLine = L.polyline(trackCoords, {
              color: "#2f6f7a",
              weight: 4,
              opacity: 0.88,
            }).addTo(trackMap);
          }

          pinMarkersLayer = L.layerGroup().addTo(trackMap);

          if (trackCoords.length >= 2 && trackLine) {
            trackMap.fitBounds(trackLine.getBounds(), {
              padding: [28, 28],
              maxZoom: 15,
            });
          } else {
            trackMap.setView([35.08, -115.42], 12);
          }
          refreshPinsNearSelection();
        }

        async function applyFilter() {
          const q = searchEl.value.trim().toLowerCase();
          if (!q) {
            photosFiltered = photos.slice();
            pinsFiltered = pinList.slice();
          } else {
            photosFiltered = photos.filter(function (p) {
              var blob =
                String(p.filename) +
                " " +
                String(p.taken_at || "") +
                " " +
                String(p.latitude) +
                " " +
                String(p.longitude);
              return blob.toLowerCase().indexOf(q) !== -1;
            });
            pinsFiltered = pinList.filter(function (w) {
              var blob =
                String(w.name || "") +
                " " +
                String(w.taken_at || "") +
                " " +
                String(w.latitude) +
                " " +
                String(w.longitude);
              return blob.toLowerCase().indexOf(q) !== -1;
            });
          }
          if (photosFiltered.length === 0 && pinsFiltered.length === 0) {
            await persistNotesForCurrentSelection();
            selected = null;
            photoEl.removeAttribute("src");
            showPhotoLoading(false);
            showPhotoError("");
            metaEl.textContent = "No rows match the filter.";
            var notesTa = document.getElementById("photo-notes");
            if (notesTa) {
              notesTa.value = "";
            }
            setNotesStatus("", null);
            lastElevationAlongM = null;
            drawElevationProfile(document, window, profileDist, profileEle, profileTotalM, null);
            destroyMaps();
            renderPhotoList();
            renderPinList();
            return;
          }
          if (selected && selected.kind === "photo") {
            var fi = photosFiltered.findIndex(function (p) {
              return p.filename === selected.filename;
            });
            if (fi >= 0) {
              await selectPhotoByIndex(fi);
              return;
            }
          }
          if (selected && selected.kind === "pin") {
            var pi = pinsFiltered.findIndex(function (w) {
              return w.pin_index === selected.pin_index;
            });
            if (pi >= 0) {
              await selectPinByIndex(pi);
              return;
            }
          }
          if (photosFiltered.length > 0) {
            await selectPhotoByIndex(0);
          } else {
            await selectPinByIndex(0);
          }
        }

        function blurListFocusIfNeeded() {
          var ae = document.activeElement;
          if (
            ae &&
            ((listPhotosEl && listPhotosEl.contains(ae)) ||
              (listPinsEl && listPinsEl.contains(ae)))
          ) {
            ae.blur();
          }
        }

        function scrollSelectedListItemIntoView() {
          if (selected && selected.kind === "photo" && listPhotosEl) {
            var li = listPhotosEl.querySelector("li.is-selected");
            if (li) {
              li.scrollIntoView({ block: "nearest", behavior: "smooth" });
            }
          } else if (selected && selected.kind === "pin" && listPinsEl) {
            var li2 = listPinsEl.querySelector("li.is-selected");
            if (li2) {
              li2.scrollIntoView({ block: "nearest", behavior: "smooth" });
            }
          }
        }

        function keyboardTargetAllowsListArrows(target) {
          if (!target || !target.tagName) {
            return true;
          }
          var tag = target.tagName;
          if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") {
            return false;
          }
          if (target.closest && target.closest(".leaflet-container")) {
            return false;
          }
          return true;
        }

        async function applySelection(sel) {
          await persistNotesForCurrentSelection();
          selected = sel;
          var p = sel;
          setPhotoPanelMode(p.kind === "pin");
          if (p.kind === "photo") {
            photoEl.alt = p.filename;
            var mediaMessage = photoMediaStatusMessage(p);
            if (mediaMessage) {
              photoEl.removeAttribute("src");
              showPhotoLoading(false);
              showPhotoError(mediaMessage);
            } else {
              showPhotoError("");
              showPhotoLoading(true);
              photoEl.removeAttribute("src");
              photoEl.src = p.media_url || "/media/" + encodeURIComponent(p.filename);
            }
          } else {
            photoEl.removeAttribute("src");
            photoEl.alt = p.name || "Waypoint";
            showPhotoLoading(false);
            showPhotoError("");
          }
          renderMeta(p);
          syncNotesFromSelection();
          ensureMaps();
          var lat = Number(p.latitude);
          var lon = Number(p.longitude);
          var ll = [lat, lon];

          trackMarker.setLatLng(ll);
          trackMarker.addTo(trackMap);
          // Keep survey-map zoom unchanged while following the current selection.
          trackMap.panTo(ll, { animate: true });

          photoMarker.setLatLng(ll);
          photoMarker.addTo(photoMap);
          photoMap.setView(ll, PHOTO_MAP_DEFAULT_ZOOM, { animate: true });

          updateElevationForSelection(lat, lon);

          renderPhotoList();
          renderPinList();
          blurListFocusIfNeeded();
          scrollSelectedListItemIntoView();
          if (p.kind === "photo") {
            scrollNearbyPinsIntoView();
          }
          requestAnimationFrame(function () {
            setTimeout(function () {
              invalidateMaps();
              refreshPinsNearSelection();
            }, 50);
          });
        }

        async function selectPhotoByIndex(i) {
          if (i < 0 || i >= photosFiltered.length) {
            return;
          }
          activePinIndex = null;
          await applySelection(wrapPhoto(photosFiltered[i]));
        }

        async function selectPinByIndex(i) {
          if (i < 0 || i >= pinsFiltered.length) {
            return;
          }
          var pin = wrapPin(pinsFiltered[i]);
          activePinIndex = pin.pin_index;
          var nearestFilename = closestPhotoFilenameForCoords(pin.latitude, pin.longitude);
          if (nearestFilename) {
            var pidx = photosFiltered.findIndex(function (p) {
              return p.filename === nearestFilename;
            });
            if (pidx >= 0) {
              await applySelection(wrapPhoto(photosFiltered[pidx]));
              return;
            }
            var pidxAll = photos.findIndex(function (p) {
              return p.filename === nearestFilename;
            });
            if (pidxAll >= 0) {
              await applySelection(wrapPhoto(photos[pidxAll]));
              return;
            }
          }
          await applySelection(pin);
        }

        function clearListKeyboardMoved() {
          listPanel.classList.remove("list-keyboard-moved");
        }

        listPanel.addEventListener(
          "mousemove",
          function () {
            clearListKeyboardMoved();
          },
          { passive: true }
        );
        listPanel.addEventListener(
          "mousedown",
          function () {
            clearListKeyboardMoved();
          },
          { passive: true }
        );

        document.addEventListener("keydown", function (e) {
          if (e.key === "Escape" && lightboxOpen) {
            e.preventDefault();
            closePhotoLightbox();
            return;
          }
          if (e.key !== "ArrowDown" && e.key !== "ArrowUp") {
            return;
          }
          if (
            mainEl.hidden ||
            (photosFiltered.length === 0 && pinsFiltered.length === 0)
          ) {
            return;
          }
          if (!keyboardTargetAllowsListArrows(e.target)) {
            return;
          }
          e.preventDefault();
          listPanel.classList.add("list-keyboard-moved");
          if (selected && selected.kind === "pin") {
            if (pinsFiltered.length === 0) {
              return;
            }
            var pidx = pinsFiltered.findIndex(function (w) {
              return w.pin_index === selected.pin_index;
            });
            if (pidx < 0) {
              pidx = 0;
            }
            if (e.key === "ArrowDown") {
              pidx = Math.min(pinsFiltered.length - 1, pidx + 1);
            } else {
              pidx = Math.max(0, pidx - 1);
            }
            void selectPinByIndex(pidx).catch(function () {});
            return;
          }
          if (photosFiltered.length === 0) {
            return;
          }
          var idx =
            selected && selected.kind === "photo"
              ? photosFiltered.findIndex(function (p) {
                  return p.filename === selected.filename;
                })
              : 0;
          if (idx < 0) {
            idx = 0;
          }
          if (e.key === "ArrowDown") {
            idx = Math.min(photosFiltered.length - 1, idx + 1);
          } else {
            idx = Math.max(0, idx - 1);
          }
          void selectPhotoByIndex(idx).catch(function () {});
        });

        searchEl.addEventListener("input", function () {
          void applyFilter().catch(function () {});
        });
        if (photoEl) {
          photoEl.addEventListener("click", function () {
            openPhotoLightbox();
          });
          photoEl.addEventListener("load", function () {
            showPhotoLoading(false);
          });
          photoEl.addEventListener("error", function () {
            showPhotoLoading(false);
            if (selected && selected.kind === "photo") {
              showPhotoError("The browser could not load this photo from " + (selected.media_url || "the media route") + ".");
            }
          });
        }
        if (photoLightboxEl) {
          photoLightboxEl.addEventListener("click", function (e) {
            if (e.target === photoLightboxEl) {
              closePhotoLightbox();
            }
          });
        }
        var lbClose = document.getElementById("photo-lightbox-close");
        if (lbClose) {
          lbClose.addEventListener("click", function () {
            closePhotoLightbox();
          });
        }
        var lbZoomIn = document.getElementById("photo-lightbox-zoom-in");
        if (lbZoomIn) {
          lbZoomIn.addEventListener("click", function () {
            changeLightboxZoom(1.2);
          });
        }
        var lbZoomOut = document.getElementById("photo-lightbox-zoom-out");
        if (lbZoomOut) {
          lbZoomOut.addEventListener("click", function () {
            changeLightboxZoom(1 / 1.2);
          });
        }
        var lbReset = document.getElementById("photo-lightbox-reset");
        if (lbReset) {
          lbReset.addEventListener("click", function () {
            resetLightboxView();
          });
        }
        if (photoLightboxStageEl) {
          photoLightboxStageEl.addEventListener(
            "wheel",
            function (e) {
              if (!lightboxOpen) {
                return;
              }
              e.preventDefault();
              changeLightboxZoom(e.deltaY < 0 ? 1.1 : 1 / 1.1);
            },
            { passive: false }
          );
          photoLightboxStageEl.addEventListener("pointerdown", function (e) {
            if (!lightboxOpen || lightboxScale <= 1.01) {
              return;
            }
            lightboxDragging = true;
            lightboxDragStartX = e.clientX;
            lightboxDragStartY = e.clientY;
            lightboxStartPanX = lightboxPanX;
            lightboxStartPanY = lightboxPanY;
            photoLightboxStageEl.classList.add("is-dragging");
            photoLightboxStageEl.setPointerCapture(e.pointerId);
          });
          photoLightboxStageEl.addEventListener("pointermove", function (e) {
            if (!lightboxDragging) {
              return;
            }
            lightboxPanX = lightboxStartPanX + (e.clientX - lightboxDragStartX);
            lightboxPanY = lightboxStartPanY + (e.clientY - lightboxDragStartY);
            applyLightboxTransform();
          });
          photoLightboxStageEl.addEventListener("pointerup", function (e) {
            if (!lightboxDragging) {
              return;
            }
            lightboxDragging = false;
            photoLightboxStageEl.classList.remove("is-dragging");
            if (photoLightboxStageEl.hasPointerCapture(e.pointerId)) {
              photoLightboxStageEl.releasePointerCapture(e.pointerId);
            }
          });
          photoLightboxStageEl.addEventListener("pointercancel", function (e) {
            if (!lightboxDragging) {
              return;
            }
            lightboxDragging = false;
            photoLightboxStageEl.classList.remove("is-dragging");
            if (photoLightboxStageEl.hasPointerCapture(e.pointerId)) {
              photoLightboxStageEl.releasePointerCapture(e.pointerId);
            }
          });
        }

        var recenterTrackBtn = document.getElementById("recenter-track-btn");
        if (recenterTrackBtn) {
          recenterTrackBtn.addEventListener("click", function () {
            recenterTrackMap();
          });
        }
        var recenterPhotoBtn = document.getElementById("recenter-photo-btn");
        if (recenterPhotoBtn) {
          recenterPhotoBtn.addEventListener("click", function () {
            recenterPhotoMap();
          });
        }
        if (trackBasemapBtn) {
          trackBasemapBtn.addEventListener("click", function () {
            toggleTrackBasemap();
          });
        }
        if (photoBasemapBtn) {
          photoBasemapBtn.addEventListener("click", function () {
            togglePhotoBasemap();
          });
        }
        updateBasemapButtons();

        window.addEventListener("resize", function () {
          invalidateMaps();
          if (lightboxOpen) {
            updateLightboxBaseScale();
            applyLightboxTransform();
          }
        });

        const loadPromise = Promise.all([
          fetch("/api/photos").then(function (r) {
            if (!r.ok) {
              throw new Error("photos: " + r.statusText);
            }
            return r.json();
          }),
          fetch("/api/track-profile").then(function (r) {
            if (!r.ok) {
              throw new Error("track-profile: " + r.statusText);
            }
            return r.json();
          }),
          fetch("/api/pins").then(function (r) {
            if (!r.ok) {
              return [];
            }
            return r.json();
          }),
          fetch("/api/config").then(function (r) {
            if (!r.ok) {
              return {};
            }
            return r.json();
          }),
        ])
          .then(function (triple) {
            var data = triple[0];
            var prof = triple[1];
            var pinsRaw = triple[2];
            var configRaw = triple[3] || {};
            notesReadOnly = !!configRaw.notes_read_only;
            photos = Array.isArray(data) ? data : [];
            pinList = Array.isArray(pinsRaw) ? pinsRaw : [];
            trackCoords =
              prof && Array.isArray(prof.coordinates) ? prof.coordinates : [];
            profileDist =
              prof && Array.isArray(prof.distances_m) ? prof.distances_m : [];
            profileEle =
              prof && Array.isArray(prof.elevations_m) ? prof.elevations_m : [];
            profileTotalM =
              prof && typeof prof.total_distance_m === "number"
                ? prof.total_distance_m
                : 0;
            var nPhotos = photos.length;
            var nPins = pinList.length;
            var parts = [];
            if (nPhotos) {
              parts.push(nPhotos + " photo" + (nPhotos === 1 ? "" : "s"));
            }
            if (nPins) {
              parts.push(nPins + " ranger pin" + (nPins === 1 ? "" : "s"));
            }
            countLabel.textContent =
              parts.length === 0 ? "No catalog items" : parts.join(" · ");
            if (nPhotos === 0 && nPins === 0) {
              emptyEl.hidden = false;
              emptyEl.textContent =
                "No photos in survey_photos.yaml and no waypoints in track/MHCG-HITW-PINS.gpx.";
              return;
            }
            mainEl.hidden = false;
            photosFiltered = photos.slice();
            pinsFiltered = pinList.slice();
            if (photosFiltered.length > 0) {
              void selectPhotoByIndex(0).catch(function () {});
            } else {
              void selectPinByIndex(0).catch(function () {});
            }
            setTimeout(function () {
              invalidateMaps();
              var ew = document.querySelector(".elevation-wrap");
              if (ew && !ew.dataset.elevRO) {
                ew.dataset.elevRO = "1";
                if (typeof ResizeObserver !== "undefined") {
                  new ResizeObserver(function () {
                    drawElevationProfile(document, window, profileDist, profileEle, profileTotalM, lastElevationAlongM);
                  }).observe(ew);
                }
              }
            }, 200);
          })
          .catch(function (e) {
            emptyEl.hidden = false;
            emptyEl.textContent = "Could not load data: " + e.message;
          });

        (function bindPhotoNotesEditor() {
          var ta = document.getElementById("photo-notes");
          if (!ta || ta.dataset.boundNotes === "1") {
            return;
          }
          ta.dataset.boundNotes = "1";
          ta.addEventListener("input", scheduleNotesDebouncedSave);
          ta.addEventListener("blur", function () {
            if (notesDebounceTimer) {
              clearTimeout(notesDebounceTimer);
              notesDebounceTimer = null;
            }
            void persistNotesForCurrentSelection();
          });
        })();

        return {
          applyFilter: applyFilter,
          loadPromise: loadPromise,
          persistNotesForCurrentSelection: persistNotesForCurrentSelection,
          selectPhotoByIndex: selectPhotoByIndex,
          selectPinByIndex: selectPinByIndex,
          getSelected: function () {
            return selected;
          },
        };
}
