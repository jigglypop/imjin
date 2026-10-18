// Recorded battle music: the score tracks played one after another, in turn, while a battle runs. They stream through
// <audio> elements (a decoded four-minute track would hold some 80 MB of samples, too much for a phone) into the
// context, so the master mute and the music switch govern them like the rest of the mix.

const TRACKS = [
  'audio/music_battle_daechwita.mp3',
  'audio/music_battle_iron_march.mp3',
  'audio/music_battle_daughter_of_the_sea.mp3',
  'audio/music_battle_iron_march_of_daejo.mp3',
];

export class BattleTracks {
  private readonly els: HTMLAudioElement[] = [];
  private current = -1;
  private playing = false;

  constructor(ctx: AudioContext, dest: AudioNode, base: string) {
    for (const src of TRACKS) {
      const el = new Audio();
      el.src = base + src;
      el.preload = 'none';
      el.crossOrigin = 'anonymous';
      // One track ends, the next begins, round and round for as long as the battle lasts.
      el.addEventListener('ended', () => {
        if (this.playing) this.next();
      });
      ctx.createMediaElementSource(el).connect(dest);
      this.els.push(el);
    }
  }

  /** Starts the score (from the track after the last one heard) or lets it run on if it already plays. */
  play() {
    if (this.playing) return;
    this.playing = true;
    if (this.current < 0) this.current = Math.floor(Math.random() * this.els.length) - 1;
    this.next();
  }

  /** Stops the score. The caller fades the gain first; this only pauses the element once it is silent. */
  stop() {
    this.playing = false;
    for (const el of this.els) el.pause();
  }

  private next() {
    this.current = (this.current + 1) % this.els.length;
    const el = this.els[this.current]!;
    el.currentTime = 0;
    void el.play().catch(() => {
      // Autoplay refused (no gesture yet): the next play() after a gesture tries again.
      this.playing = false;
    });
  }
}
