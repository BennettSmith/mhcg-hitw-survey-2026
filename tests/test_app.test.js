import fs from "node:fs";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import {
  buildCopyPayload,
  buildGoogleEarthUrl,
  decimalToDmsHemisphere,
  fmtDmsSeconds,
  initSurveyApp,
} from "../webapp/static/app.js";
import {
  closestAlongTrackM,
  createBaseLayers,
  drawElevationProfile,
  elevationAtDistance,
  haversineMeters,
  photoMediaStatusMessage,
  setMapBasemap,
  trailElevationMForCoords,
  updateBasemapButton,
} from "../webapp/static/app-helpers.js";

const repoRoot = path.resolve(import.meta.dirname, "..");
const indexHtml = fs.readFileSync(path.join(repoRoot, "webapp/static/index.html"), "utf8");

function installCanvasStub() {
  Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
    configurable: true,
    value() {
      return {
        arc() {},
        beginPath() {},
        clearRect() {},
        closePath() {},
        fill() {},
        fillText() {},
        lineTo() {},
        moveTo() {},
        setLineDash() {},
        setTransform() {},
        stroke() {},
      };
    },
  });
}

function createLeafletStub() {
  function attachLayer(target, layer) {
    if (target && Array.isArray(target._layers)) {
      target._layers.push(layer);
    }
  }

  function makeLayer(extra = {}) {
    return {
      addTo(target) {
        attachLayer(target, this);
        this._target = target;
        return this;
      },
      bindPopup() {
        return this;
      },
      ...extra,
    };
  }

  return {
    circleMarker(latlng) {
      return makeLayer({
        latlng,
        setLatLng(next) {
          this.latlng = next;
          return this;
        },
      });
    },
    divIcon(options) {
      return options;
    },
    layerGroup() {
      return makeLayer({
        _layers: [],
        clearLayers() {
          this._layers = [];
        },
      });
    },
    map(id) {
      return {
        _layers: [],
        fitBounds(bounds, options) {
          this.lastFitBounds = { bounds, options };
          return this;
        },
        id,
        invalidateSize() {
          this.invalidated = true;
        },
        panTo(latlng, options) {
          this.lastPanTo = { latlng, options };
          return this;
        },
        remove() {
          this.removed = true;
        },
        removeLayer(layer) {
          this._layers = this._layers.filter((item) => item !== layer);
          return this;
        },
        setView(latlng, zoom, options) {
          this.lastSetView = { latlng, zoom, options };
          return this;
        },
      };
    },
    marker(latlng, options) {
      return makeLayer({ latlng, options });
    },
    polyline(coords) {
      return makeLayer({
        coords,
        getBounds() {
          return coords;
        },
      });
    },
    tileLayer(url, options) {
      return makeLayer({ options, url });
    },
  };
}

function installDom() {
  document.open();
  document.write(indexHtml);
  document.close();
  installCanvasStub();
  Object.defineProperty(window, "requestAnimationFrame", {
    configurable: true,
    value(callback) {
      callback();
      return 1;
    },
  });
  window.alert = vi.fn();
  window.open = vi.fn(() => ({ focus: vi.fn() }));
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
  Element.prototype.hasPointerCapture = vi.fn(() => true);
  Object.defineProperty(window.navigator, "clipboard", {
    configurable: true,
    value: { writeText: vi.fn(() => Promise.resolve()) },
  });
  Object.defineProperty(window, "ResizeObserver", {
    configurable: true,
    value: class {
      observe() {}
    },
  });
}

function jsonResponse(data, ok = true, statusText = ok ? "OK" : "ERR") {
  return {
    ok,
    statusText,
    json: async () => data,
  };
}

function createFetchStub(overrides = {}) {
  return vi.fn(async (url, options = {}) => {
    if (options.method === "PUT") {
      return jsonResponse({ ok: true });
    }
    if (url in overrides) {
      return overrides[url];
    }
    if (url === "/api/photos") {
      return jsonResponse([
        {
          filename: "photo-1.jpg",
          taken_at: "2026-04-17T08:26:25-07:00",
          latitude: 35.1,
          longitude: -115.4,
          notes: "seed note",
          media_url: "/media/photo-1.jpg",
          media_status: "ok",
          media_bytes: 10,
        },
      ]);
    }
    if (url === "/api/track-profile") {
      return jsonResponse({
        coordinates: [
          [35.1, -115.4],
          [35.1005, -115.4005],
          [35.101, -115.401],
        ],
        distances_m: [0, 10, 20],
        elevations_m: [1000, 1010, 1020],
        total_distance_m: 20,
      });
    }
    if (url === "/api/pins") {
      return jsonResponse([
        {
          pin_index: 0,
          name: "Ranger note",
          taken_at: "2026-04-17T09:00:00Z",
          latitude: 35.1004,
          longitude: -115.4004,
          elevation_m: 1008,
        },
      ]);
    }
    if (url === "/api/config") {
      return jsonResponse({ notes_read_only: false });
    }
    throw new Error(`Unhandled fetch: ${url}`);
  });
}

async function flushPromises() {
  await Promise.resolve();
  await Promise.resolve();
}

beforeEach(() => {
  vi.useFakeTimers();
  installDom();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

describe("frontend helpers", () => {
  test("format coordinate helpers", () => {
    expect(fmtDmsSeconds(10)).toBe("10");
    expect(decimalToDmsHemisphere(35.5, true)).toBe('35°30\'0" N');
    expect(buildCopyPayload("tab", 35.1, -115.4)).toBe("35.1\t-115.4");
    expect(buildCopyPayload("bad", 35.1, -115.4)).toBe("");
    expect(buildGoogleEarthUrl(35.1, -115.4)).toContain("earth.google.com");
    expect(buildGoogleEarthUrl("bad", -115.4)).toBe("");
  });

  test("covers helper branches and rendering utilities", () => {
    expect(photoMediaStatusMessage({ kind: "photo", media_status: "missing" })).toContain("missing");
    expect(photoMediaStatusMessage({ kind: "photo", media_status: "git_lfs_pointer" })).toContain("Git LFS");
    expect(photoMediaStatusMessage({ kind: "photo", media_status: "invalid_filename" })).toContain("not valid");
    expect(photoMediaStatusMessage({ kind: "pin" })).toBe("");

    const layers = createBaseLayers(createLeafletStub(), "Topo", "Sat");
    const map = createLeafletStub().map("map");
    setMapBasemap(map, layers, "sat");
    setMapBasemap(map, layers, "topo");
    const btn = document.createElement("button");
    updateBasemapButton(btn, "sat");
    expect(btn.textContent).toContain("Topo");
    updateBasemapButton(btn, "topo");
    expect(btn.textContent).toContain("Satelite");

    expect(elevationAtDistance([], [], 10)).toBe(null);
    expect(elevationAtDistance([0, 10], [100, 110], -1)).toBe(100);
    expect(elevationAtDistance([0, 10], [100, 110], 20)).toBe(110);
    expect(elevationAtDistance([0, 10], [100, Number.NaN], 5)).toBe(100);
    expect(closestAlongTrackM([[35.1, -115.4], [35.1005, -115.4005]], [0, 10], 35.10025, -115.40025)).toBeGreaterThan(0);
    expect(haversineMeters(35.1, -115.4, 35.1, -115.4)).toBe(0);
    expect(trailElevationMForCoords([[35.1, -115.4], [35.1005, -115.4005]], [0, 10], [100, 110], 35.10025, -115.40025)).toBeGreaterThan(100);
    expect(trailElevationMForCoords([], [], [], 0, 0)).toBe(null);

    const wrap = document.querySelector(".elevation-wrap");
    const canvas = document.getElementById("elevation-canvas");
    Object.defineProperty(wrap, "clientWidth", { configurable: true, value: 320 });
    Object.defineProperty(wrap, "clientHeight", { configurable: true, value: 120 });
    const ctx = {
      arc() {},
      beginPath() {},
      clearRect() {},
      closePath() {},
      fill() {},
      fillText: vi.fn(),
      lineTo() {},
      moveTo() {},
      setLineDash() {},
      setTransform() {},
      stroke() {},
    };
    canvas.getContext = () => ctx;
    drawElevationProfile(document, window, [], [], 0, null);
    expect(ctx.fillText).toHaveBeenCalledWith("No GPX profile", 10, 22);
    drawElevationProfile(document, window, [0], [100], 0, null);
    expect(ctx.fillText).toHaveBeenCalledWith("Not enough elevation points", 10, 22);
    drawElevationProfile(document, window, [0, 10, 20], [100, 110, 120], 20, 10);
    expect(canvas.width).toBeGreaterThan(0);
  });
});

describe("initSurveyApp", () => {
  test("loads the initial photo selection and renders metadata", async () => {
    const fetch = createFetchStub();
    const app = initSurveyApp({ fetch, leaflet: createLeafletStub() });
    await app.loadPromise;

    expect(fetch).toHaveBeenCalledWith("/api/photos");
    expect(document.getElementById("count-label").textContent).toContain("1 photo");
    expect(document.getElementById("main").hidden).toBe(false);
    expect(document.getElementById("photo").getAttribute("src")).toBe("/media/photo-1.jpg");
    expect(document.getElementById("meta-block").textContent).toContain("photo-1.jpg");
    expect(document.getElementById("photo-notes").value).toBe("seed note");
    expect(app.getSelected().filename).toBe("photo-1.jpg");
  });

  test("debounces note saving and supports copy and Earth actions", async () => {
    const fetch = createFetchStub();
    const app = initSurveyApp({ fetch, leaflet: createLeafletStub() });
    await app.loadPromise;

    const textarea = document.getElementById("photo-notes");
    textarea.value = "updated note";
    textarea.dispatchEvent(new window.Event("input", { bubbles: true }));
    await vi.advanceTimersByTimeAsync(700);
    await flushPromises();

    const putCall = fetch.mock.calls.find((call) => call[1] && call[1].method === "PUT");
    expect(putCall[0]).toBe("/api/photos/photo-1.jpg/notes");
    expect(JSON.parse(putCall[1].body)).toEqual({ notes: "updated note" });
    expect(document.getElementById("photo-notes-status").textContent).toBe("Saved");

    document.getElementById("copy-coords-btn").click();
    await flushPromises();
    expect(window.navigator.clipboard.writeText).toHaveBeenCalled();

    document.getElementById("open-earth-btn").click();
    expect(window.open).toHaveBeenCalled();
  });

  test("handles note save failure, timeout clearing, and clipboard fallback", async () => {
    delete window.navigator.clipboard;
    document.execCommand = vi.fn(() => {
      throw new Error("copy failed");
    });
    const fetch = createFetchStub({
      "/api/photos": jsonResponse([
        {
          filename: "photo-1.jpg",
          taken_at: "2026-04-17T08:26:25-07:00",
          latitude: Number.NaN,
          longitude: Number.NaN,
          notes: "seed note",
          media_url: "/media/photo-1.jpg",
          media_status: "ok",
          media_bytes: 10,
        },
      ]),
    });
    fetch.mockImplementation(async (url, options = {}) => {
      if (options.method === "PUT") {
        return jsonResponse({}, false, "Nope");
      }
      if (url === "/api/photos") {
        return jsonResponse([
          {
            filename: "photo-1.jpg",
            taken_at: "2026-04-17T08:26:25-07:00",
            latitude: Number.NaN,
            longitude: Number.NaN,
            notes: "seed note",
            media_url: "/media/photo-1.jpg",
            media_status: "ok",
            media_bytes: 10,
          },
        ]);
      }
      return createFetchStub()(url, options);
    });
    const app = initSurveyApp({ fetch, leaflet: createLeafletStub() });
    await app.loadPromise;
    const textarea = document.getElementById("photo-notes");
    textarea.value = "updated once";
    textarea.dispatchEvent(new window.Event("input", { bubbles: true }));
    textarea.value = "updated twice";
    textarea.dispatchEvent(new window.Event("input", { bubbles: true }));
    await vi.advanceTimersByTimeAsync(700);
    await flushPromises();
    expect(document.getElementById("photo-notes-status").textContent).toBe("Save failed");
    await vi.advanceTimersByTimeAsync(2300);
    expect(document.getElementById("photo-notes-status").textContent).toBe("");

    document.getElementById("copy-coords-btn").click();
    await flushPromises();
    expect(window.alert).toHaveBeenCalledWith("Could not copy to the clipboard.");
    document.getElementById("open-earth-btn").click();
    expect(window.alert).toHaveBeenCalledWith("Could not open Google Earth for this location.");
  });

  test("handles filters, photo load errors, and lightbox interactions", async () => {
    const fetch = createFetchStub();
    const app = initSurveyApp({ fetch, leaflet: createLeafletStub() });
    await app.loadPromise;

    const photoEl = document.getElementById("photo");
    photoEl.dispatchEvent(new window.Event("error"));
    expect(document.getElementById("photo-error").textContent).toContain("browser could not load this photo");

    Object.defineProperty(document.getElementById("photo-lightbox-img"), "complete", {
      configurable: true,
      value: true,
    });
    photoEl.click();
    expect(document.getElementById("photo-lightbox").hidden).toBe(false);
    document.getElementById("photo-lightbox-close").click();
    expect(document.getElementById("photo-lightbox").hidden).toBe(true);

    const searchEl = document.getElementById("search");
    searchEl.value = "nope";
    searchEl.dispatchEvent(new window.Event("input", { bubbles: true }));
    await flushPromises();
    expect(document.getElementById("meta-block").textContent).toContain("No rows match the filter.");
    expect(app.getSelected()).toBe(null);
  });

  test("covers lightbox zoom, drag, resize, and map controls", async () => {
    const fetch = createFetchStub();
    const app = initSurveyApp({ fetch, leaflet: createLeafletStub() });
    await app.loadPromise;

    const stage = document.getElementById("photo-lightbox-stage");
    const image = document.getElementById("photo-lightbox-img");
    Object.defineProperty(stage, "clientWidth", { configurable: true, value: 300 });
    Object.defineProperty(stage, "clientHeight", { configurable: true, value: 200 });
    Object.defineProperty(image, "naturalWidth", { configurable: true, value: 600 });
    Object.defineProperty(image, "naturalHeight", { configurable: true, value: 400 });
    Object.defineProperty(image, "complete", { configurable: true, value: true });

    document.getElementById("photo").click();
    document.getElementById("photo-lightbox-zoom-in").click();
    stage.dispatchEvent(new window.WheelEvent("wheel", { deltaY: -1, bubbles: true }));
    const pointerDown = new window.Event("pointerdown", { bubbles: true });
    Object.assign(pointerDown, { pointerId: 1, clientX: 10, clientY: 10 });
    stage.dispatchEvent(pointerDown);
    const pointerMove = new window.Event("pointermove", { bubbles: true });
    Object.assign(pointerMove, { pointerId: 1, clientX: 20, clientY: 20 });
    stage.dispatchEvent(pointerMove);
    const pointerUp = new window.Event("pointerup", { bubbles: true });
    Object.assign(pointerUp, { pointerId: 1, clientX: 20, clientY: 20 });
    stage.dispatchEvent(pointerUp);
    const pointerCancel = new window.Event("pointercancel", { bubbles: true });
    Object.assign(pointerCancel, { pointerId: 1, clientX: 20, clientY: 20 });
    stage.dispatchEvent(pointerCancel);
    window.dispatchEvent(new window.Event("resize"));
    expect(image.style.transform).toContain("scale");

    document.getElementById("basemap-track-btn").click();
    document.getElementById("basemap-photo-btn").click();
    document.getElementById("recenter-track-btn").click();
    document.getElementById("recenter-photo-btn").click();
    expect(document.getElementById("basemap-track-btn").textContent).toContain("Sat");
  });

  test("supports pin-only data and read-only notes", async () => {
    const fetch = createFetchStub({
      "/api/photos": jsonResponse([]),
      "/api/pins": jsonResponse([
        {
          pin_index: 0,
          name: "Solo pin",
          taken_at: "2026-04-17T09:00:00Z",
          latitude: 35.1004,
          longitude: -115.4004,
          elevation_m: 1008,
        },
      ]),
      "/api/config": jsonResponse({ notes_read_only: true }),
    });

    const app = initSurveyApp({ fetch, leaflet: createLeafletStub() });
    await app.loadPromise;
    expect(document.getElementById("count-label").textContent).toContain("1 ranger pin");
    expect(document.getElementById("photo-notes").disabled).toBe(true);
    expect(document.getElementById("photo-notes").placeholder).toContain("saved only for survey photos");
    expect(document.querySelector(".photo-card > h2").textContent).toBe("Ranger waypoint");
    expect(app.getSelected().kind).toBe("pin");
  });

  test("supports keyboard navigation, pin selection, and selection-preserving filtering", async () => {
    const fetch = createFetchStub({
      "/api/photos": jsonResponse([
        {
          filename: "photo-1.jpg",
          taken_at: "2026-04-17T08:26:25-07:00",
          latitude: 35.1,
          longitude: -115.4,
          notes: "seed note",
          media_url: "",
          media_status: "missing",
          media_bytes: 0,
        },
        {
          filename: "photo-2.jpg",
          taken_at: "2026-04-17T08:30:00-07:00",
          latitude: 35.1004,
          longitude: -115.4004,
          notes: "two",
          media_url: "/media/photo-2.jpg",
          media_status: "ok",
          media_bytes: 10,
        },
      ]),
      "/api/pins": jsonResponse([
        {
          pin_index: 0,
          name: "Ranger note",
          taken_at: "2026-04-17T09:00:00Z",
          latitude: 35.1004,
          longitude: -115.4004,
          elevation_m: null,
        },
      ]),
    });
    const app = initSurveyApp({ fetch, leaflet: createLeafletStub() });
    await app.loadPromise;
    await app.selectPhotoByIndex(1);
    expect(app.getSelected().filename).toBe("photo-2.jpg");

    document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }));
    await flushPromises();
    expect(app.getSelected().filename).toBe("photo-1.jpg");
    expect(document.getElementById("photo-error").textContent).toContain("missing from the deployed photos directory");

    document.querySelector('#list-pins button').click();
    await flushPromises();
    expect(document.querySelector('#list-pins li').classList.contains('is-selected')).toBe(true);

    const searchEl = document.getElementById("search");
    searchEl.value = "photo-2";
    await app.applyFilter();
    expect(document.querySelectorAll('#list-photos li').length).toBe(1);
  });

  test("shows empty and load-failure states", async () => {
    const emptyFetch = createFetchStub({
      "/api/photos": jsonResponse([]),
      "/api/pins": jsonResponse([]),
    });
    const emptyApp = initSurveyApp({ fetch: emptyFetch, leaflet: createLeafletStub() });
    await emptyApp.loadPromise;
    expect(document.getElementById("empty").textContent).toContain("No photos in survey_photos.yaml");

    installDom();
    const failingFetch = createFetchStub({
      "/api/photos": jsonResponse({}, false, "Boom"),
    });
    const failingApp = initSurveyApp({ fetch: failingFetch, leaflet: createLeafletStub() });
    await failingApp.loadPromise;
    expect(document.getElementById("empty").textContent).toContain("Could not load data");
  });

  test("covers partial fetch failures, duplicate note binding guard, and arrow-key ignore paths", async () => {
    const fetch = createFetchStub({
      "/api/pins": jsonResponse({}, false, "pins down"),
      "/api/config": jsonResponse({}, false, "config down"),
      "/api/track-profile": jsonResponse({ coordinates: [], distances_m: [], elevations_m: [], total_distance_m: 0 }),
    });
    const app = initSurveyApp({ fetch, leaflet: createLeafletStub() });
    await app.loadPromise;
    initSurveyApp({ fetch, leaflet: createLeafletStub() });
    const textarea = document.getElementById("photo-notes");
    textarea.dispatchEvent(new window.FocusEvent("blur", { bubbles: true }));
    document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, target: textarea }));
    document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await vi.advanceTimersByTimeAsync(250);
    expect(document.getElementById("count-label").textContent).toContain("1 photo");
    expect(app.getSelected().filename).toBe("photo-1.jpg");
  });
});
