// AudioWorklet processor: accumulates the 128-sample render quanta into
// fixed 1024-sample frames and posts them to the main thread, where the
// chord detector runs. Served verbatim from /public so AudioWorklet.addModule
// always receives a real, same-origin script (no bundler inlining).

const FRAME_SIZE = 1024;

class PcmFrameProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._buffer = new Float32Array(FRAME_SIZE);
    this._offset = 0;
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || input.length === 0) {
      return true;
    }
    const channel = input[0];
    if (!channel) {
      return true;
    }

    for (let i = 0; i < channel.length; i++) {
      this._buffer[this._offset++] = channel[i];
      if (this._offset === FRAME_SIZE) {
        const frame = this._buffer.slice(0);
        this.port.postMessage(frame, [frame.buffer]);
        this._buffer = new Float32Array(FRAME_SIZE);
        this._offset = 0;
      }
    }
    return true;
  }
}

registerProcessor('pcm-frame-processor', PcmFrameProcessor);
