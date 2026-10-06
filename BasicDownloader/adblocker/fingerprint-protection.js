(() => {
  'use strict';
  // Packaged opt-in MAIN-world script. No storage, network, page-specific tests,
  // or reporting. A fresh per-document salt reduces cross-visit stable readouts.
  const salt = crypto.getRandomValues(new Uint32Array(2));
  const canvasSeeds = new WeakMap();
  let sequence = 0;
  const seedFor = canvas => {
    if (!canvasSeeds.has(canvas)) canvasSeeds.set(canvas, (salt[0] ^ (++sequence * 2654435761)) >>> 0);
    return canvasSeeds.get(canvas);
  };
  function noisePixels(image, seed) {
    const data = image.data;
    if (!(data instanceof Uint8ClampedArray) || data.length < 4) return image;
    const pixel = seed % (data.length / 4);
    data[pixel * 4 + seed % 3] ^= 1; // one color LSB; alpha stays exact
    return image;
  }
  const patch = (prototype, key, factory) => {
    const descriptor = Object.getOwnPropertyDescriptor(prototype, key);
    if (!descriptor || typeof descriptor.value !== 'function' || !descriptor.configurable) return;
    Object.defineProperty(prototype, key, { ...descriptor, value: factory(descriptor.value) });
  };
  const contextPrototype = globalThis.CanvasRenderingContext2D?.prototype;
  const canvasPrototype = globalThis.HTMLCanvasElement?.prototype;
  if (contextPrototype && canvasPrototype) {
    const nativeGet = contextPrototype.getImageData;
    const nativePut = contextPrototype.putImageData;
    patch(contextPrototype, 'getImageData', original => function (...args) {
      const image = Reflect.apply(original, this, args); // retain native exceptions
      return noisePixels(image, seedFor(this.canvas)); // returned copy only
    });
    function exportCanvas(canvas) {
      if (!canvas.width || !canvas.height) return canvas;
      const copy = document.createElement('canvas');
      copy.width = canvas.width; copy.height = canvas.height;
      const context = copy.getContext('2d');
      context.drawImage(canvas, 0, 0);
      const image = Reflect.apply(nativeGet, context, [0, 0, copy.width, copy.height]);
      Reflect.apply(nativePut, context, [noisePixels(image, seedFor(canvas)), 0, 0]);
      return copy; // rendered pixels and the original canvas are unchanged
    }
    for (const name of ['toDataURL', 'toBlob']) patch(canvasPrototype, name, original => function (...args) {
      // Validate the receiver before accessing width/height (illegal invocation).
      if (!(this instanceof HTMLCanvasElement)) return Reflect.apply(original, this, args);
      return Reflect.apply(original, exportCanvas(this), args);
    });
  }
  const audioPrototype = globalThis.AudioBuffer?.prototype;
  if (audioPrototype) {
    const channelStates = new WeakMap();
    const nativeGet = audioPrototype.getChannelData;
    function protect(buffer, channel, data) {
      if (!data.length) return;
      let channels = channelStates.get(buffer);
      if (!channels) { channels = new Map(); channelStates.set(buffer, channels); }
      let state = channels.get(channel);
      if (!state) {
        state = { index: (salt[1] ^ channel) >>> 0, last: undefined };
        channels.set(channel, state);
      }
      const index = state.index % data.length;
      if (!Number.isFinite(data[index]) || data[index] === state.last) return;
      // Preserve writable channel views. Repeated reads don't accumulate noise;
      // writing fresh samples causes a new perturbation on the next read.
      data[index] += data[index] < 0 ? 2 ** -22 : -(2 ** -22);
      state.last = data[index];
    }
    patch(audioPrototype, 'getChannelData', original => function (...args) {
      const data = Reflect.apply(original, this, args);
      protect(this, Number(args[0]) >>> 0, data);
      return data;
    });
    patch(audioPrototype, 'copyFromChannel', original => function (...args) {
      const data = Reflect.apply(nativeGet, this, [args[1]]);
      protect(this, Number(args[1]) >>> 0, data);
      return Reflect.apply(original, this, args);
    });
  }
})();
