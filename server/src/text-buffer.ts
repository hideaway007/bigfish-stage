/** Turn token deltas into sentences, flushing after 400 ms of silence. */
export class SentenceBuffer {
  private text = '';
  private timer?: ReturnType<typeof setTimeout>;
  constructor(private emit: (text: string, final?: boolean) => void, private delayMs = 400) {}
  push(delta: string) {
    clearTimeout(this.timer);
    this.text += delta;
    let boundary = 0;
    for (const match of this.text.matchAll(/[。！？!?\n]|[.](?=\s|$)/g)) boundary = match.index! + match[0].length;
    if (boundary) { const sentence = this.text.slice(0, boundary); this.text = this.text.slice(boundary); this.emit(sentence); }
    if (this.text) this.timer = setTimeout(() => this.flush(), this.delayMs);
  }
  flush(final = false) {
    clearTimeout(this.timer);
    if (this.text || final) this.emit(this.text, final || undefined);
    this.text = '';
  }
  close() { clearTimeout(this.timer); this.text = ''; }
}
