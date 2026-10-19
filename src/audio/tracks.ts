// Recorded music, the only music in the game: public/audio/music. Each situation has its own set of tracks; the
// score follows the battle (menus, the approach, the fight, the decisive moment, its end) and crossfades between
// them. The tracks stream through <audio> elements (a decoded four-minute track would hold some 80 MB of samples,
// too much for a phone) into the context, so the master mute and the music volume govern them like the rest.

export type Scene = 'menu' | 'approach' | 'battle' | 'climax' | 'victory' | 'defeat';

const DIR = 'audio/music/';
/** Which tracks suit which moment. A track may serve more than one. */
const PLAYLISTS: Record<Scene, string[]> = {
  menu: ['intro', 'trailer'],
  // Before the fleets meet: tension building, not yet the full drums.
  approach: ['countdown-to-impact', 'armada-of-shadows', 'the-dark-armada', 'armada-oscura'],
  // The fight itself.
  battle: ['relentless-war-drums', 'wall-of-drums', 'armada', 'the-golden-armada'],
  // One side is breaking: the battle is being decided.
  climax: ['the-armadas-last-stand', 'relentless-war-drums'],
  victory: ['the-final-march', 'the-golden-armada'],
  defeat: ['the-armadas-last-stand', 'armada-oscura'],
};
const FADE = 2.5;

type Track = { el: HTMLAudioElement; gain: GainNode; name: string };

export class MusicDirector {
  private readonly tracks = new Map<string, Track>();
  private scene: Scene | null = null;
  private current: Track | null = null;
  private playing = false;
  /** The last track heard in each scene, so the next pick moves on rather than repeating it. */
  private readonly last = new Map<Scene, string>();

  constructor(
    private readonly ctx: AudioContext,
    private readonly dest: AudioNode,
    private readonly base: string,
  ) {}

  private track(name: string) {
    let t = this.tracks.get(name);
    if (t) return t;
    const el = new Audio();
    el.src = `${this.base}${DIR}${name}.mp3`;
    el.preload = 'none';
    el.crossOrigin = 'anonymous';
    const gain = this.ctx.createGain();
    gain.gain.value = 0;
    this.ctx.createMediaElementSource(el).connect(gain).connect(this.dest);
    t = { el, gain, name };
    // A track that ends gives way to the next of the same scene.
    el.addEventListener('ended', () => {
      if (this.playing && this.current === t) this.start(this.pick(this.scene!), 1);
    });
    this.tracks.set(name, t);
    return t;
  }

  private pick(scene: Scene) {
    const list = PLAYLISTS[scene];
    const last = this.last.get(scene);
    const options = list.length > 1 ? list.filter((n) => n !== last && n !== this.current?.name) : list;
    const name = (options.length ? options : list)[Math.floor(Math.random() * (options.length || list.length))]!;
    this.last.set(scene, name);
    return name;
  }

  /** Moves the score to a scene: a new scene crossfades to one of its tracks; the same scene lets the track run on. */
  setScene(scene: Scene) {
    if (scene === this.scene) return;
    this.scene = scene;
    if (!this.playing) return;
    // A track that already suits the new scene keeps playing.
    if (this.current && PLAYLISTS[scene].includes(this.current.name)) return;
    this.start(this.pick(scene), FADE);
  }

  play() {
    if (this.playing || !this.scene) return;
    this.playing = true;
    if (this.current && PLAYLISTS[this.scene].includes(this.current.name)) {
      this.resume(this.current);
      return;
    }
    this.start(this.pick(this.scene), 1);
  }

  /** Stops the score. The caller fades the music gain first; this only pauses once it is silent. */
  stop() {
    this.playing = false;
    for (const t of this.tracks.values()) t.el.pause();
  }

  private resume(t: Track) {
    const now = this.ctx.currentTime;
    t.gain.gain.cancelScheduledValues(now);
    t.gain.gain.setTargetAtTime(1, now, 0.3);
    void t.el.play().catch(() => {
      this.playing = false;
    });
  }

  private start(name: string, fade: number) {
    const now = this.ctx.currentTime;
    const old = this.current;
    if (old && old.name !== name) {
      old.gain.gain.cancelScheduledValues(now);
      old.gain.gain.setTargetAtTime(0, now, fade / 3);
      window.setTimeout(() => {
        if (this.current !== old) old.el.pause();
      }, fade * 1000 + 600);
    }
    const t = this.track(name);
    this.current = t;
    if (old !== t || t.el.ended) t.el.currentTime = 0;
    t.gain.gain.cancelScheduledValues(now);
    t.gain.gain.setValueAtTime(old === t ? t.gain.gain.value : 0, now);
    t.gain.gain.setTargetAtTime(1, now, fade / 3);
    void t.el.play().catch(() => {
      // Autoplay refused (no gesture yet): the next play() after a gesture tries again.
      this.playing = false;
    });
  }
}
