// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2026 Cleedek

// Live subtitles: hands the tab's sound to offscreen.js in blocks of about
// 20 to 60 ms (one channel), instead of 375 tiny messages a second.
class LiveTap extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buf = new Float32Array(1024);
    this.n = 0;
  }
  process(inputs) {
    const chans = inputs[0];
    if (chans && chans.length) {
      const len = chans[0].length;
      for (let i = 0; i < len; i++) {
        let s = 0;
        for (const c of chans) s += c[i];
        this.buf[this.n++] = s / chans.length;
        if (this.n === this.buf.length) {
          this.port.postMessage(this.buf.slice(0));
          this.n = 0;
        }
      }
    }
    return true;
  }
}
registerProcessor('live-tap', LiveTap);
