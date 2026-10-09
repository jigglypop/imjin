#!/usr/bin/env python3
"""Builds the listening page: every sound of the game, the old and the new side by side, with its measurements.

    python3 build_page.py <dir>

<dir> (shots/progress/audio3) holds what the other scripts wrote:
  render/<before|after>_<scene>.wav   scripts/render-sounds.mjs (--prefix=before_ / after_)
  <before|after>_<scene>.wav|.json    scripts/audio/capture.mjs (real gameplay, the master bus)
It writes mp3/ (listenable copies), png/ (spectrograms), samples/ (the recorded bank) and index.html.
Needs numpy and ffmpeg; the measurements come from analyze.py.
"""
from __future__ import annotations

import html
import json
import re
import shutil
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import analyze  # noqa: E402

ROOT = Path(sys.argv[1]).resolve()
REPO = Path(__file__).resolve().parents[2]
for d in ('mp3', 'png', 'samples'):
    (ROOT / d).mkdir(exist_ok=True)

cache = {}


def listen(wav: Path):
    """mp3 copy + spectrogram + metrics of a wav; returns (mp3 name, metrics)."""
    key = str(wav)
    if key in cache:
        return cache[key]
    mp3 = ROOT / 'mp3' / (wav.stem + '.mp3')
    if not mp3.exists() or mp3.stat().st_mtime < wav.stat().st_mtime:
        subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-i', str(wav), '-codec:a', 'libmp3lame', '-q:a', '4', str(mp3)], check=True)
    metrics = analyze.analyze(str(wav), ROOT / 'png')
    cache[key] = (f'mp3/{mp3.name}', metrics)
    return cache[key]


def card(title, note, wav: Path | None, extra=''):
    if wav is None or not wav.exists():
        return f'<div class="card missing"><h4>{html.escape(title)}</h4><p>(not rendered)</p></div>'
    mp3, m = listen(wav)
    tone = m['tone_seconds_per_min']
    badge = 'bad' if tone > 60 else 'ok'
    return f'''<div class="card">
<h4>{html.escape(title)}</h4>
<p class="note">{note}</p>
<audio controls preload="none" src="{mp3}"></audio>
<a href="png/{m['spectrogram']}"><img loading="lazy" src="png/{m['spectrogram']}" alt="spectrogram of {html.escape(title)}"></a>
<dl>
<dt>피크</dt><dd>{m['peak']:.2f}</dd>
<dt>최대 순간 음량</dt><dd>{m['lufs_max_momentary']} LUFS</dd>
<dt>평균 음량</dt><dd>{m['lufs_integrated']} LUFS</dd>
<dt>트루피크</dt><dd>{m['lufs_true_peak']} dBTP</dd>
<dt>클리핑 샘플</dt><dd>{m['clipped_samples']}</dd>
<dt>순음(삐 소리) 길이</dt><dd class="{badge}">{tone} 초/분</dd>
</dl>{extra}</div>'''


def pair(title, why, before: Path, after: Path, nb='전', na='후'):
    return f'<section class="pair"><h3>{html.escape(title)}</h3><p>{why}</p><div class="cols">{card(nb, "", before)}{card(na, "", after)}</div></section>'


R = ROOT / 'render'
parts = []

# 1. The beeps, before and after.
parts.append('<h2 id="beeps">1. 삐비빅의 정체: 전/후</h2>')
parts.append(pair('메뉴·선택 화면의 음악', '무작위로 음높이가 바뀌는 사인파 플루트(350-1700 Hz)가 3~5초마다 한 음씩 울렸습니다. 베이스 드론과 먼 북소리로 바꿨습니다. 선율은 없습니다.', R / 'before_legacy_music.wav', R / 'after_music_bed_select.wav'))
parts.append(pair('클릭음', '780 Hz에서 420 Hz로 떨어지는 사인파 + 2.4 kHz 대역 잡음이었습니다. 이제 짧은 나무 두드림입니다.', R / 'before_legacy_click.wav', R / 'after_ui_click.wav'))
parts.append(pair('침몰할 때의 거품', '260-900 Hz 사인파 블립이 초당 8~22개씩 올라가는 음높이로 이어졌습니다(배 한 척당 3번). 녹음된 거품 소리의 일부로 바꿨고, 합성 대체음도 잡음 기반입니다.', R / 'before_v_bubbles.wav', R / 'after_v_bubbles.wav'))
parts.append(pair('침몰 마지막의 꼬르륵', '같은 블립 열이 섞여 있었고 음 시작마다 딱 하는 잡음이 났습니다. 저음 사인 하나씩에 각각 엔벨로프를 줬습니다.', R / 'before_v_gurgle.wav', R / 'after_v_gurgle.wav'))
parts.append(pair('접전(승선전)에서 쓰러질 때', '병사 한 명이 쓰러질 때마다 Q=8 공진 필터를 거친 3.2-5 kHz 잡음 3발(삑삑삑)이 났습니다. 이제 공진 없는 나무 부딪힘 한 번이며 초당 5번까지로 제한됩니다.', R / 'before_legacy_melee.wav', R / 'after_v_clack.wav'))
parts.append(pair('불이 붙을 때의 탁탁', '2-4 kHz Q=6 공진 잡음 5발이 짧은 피리 소리 같았습니다. 공진 없는 고역 클릭으로 바꿨습니다.', R / 'before_v_ignite.wav', R / 'after_v_ignite.wav'))
parts.append(pair('포탄이 스쳐 지나갈 때(합성 대체음)', 'Q=4로 3.2 kHz에서 0.75 kHz까지 내려가는 휘파람이었습니다. Q를 1.2로 낮췄고, 녹음 샘플이 있으면 그것을 씁니다. 스쳐 가는 소리는 0.25초에 한 번으로 제한됩니다.', R / 'before_v_whiz.wav', R / 'after_v_whiz.wav'))

# 2. Real gameplay captures.
parts.append('<h2 id="play">2. 실제 플레이 녹음 (마스터 버스, 60초)</h2><p>Chrome에서 게임을 그대로 돌리며 AudioContext 출력을 녹음했습니다. 같은 장면을 수정 전/후로 녹음했습니다.</p>')
scenes = [
    ('menu', '메뉴 (60초 대기)'),
    ('battle1x', '명량 해전 1배속 (접근과 첫 접촉)'),
    ('battle8x', '명량 해전 8배속'),
    ('battle32x', '명량 해전 32배속'),
    ('fight', '명량 해전 접전 (32배속으로 접근한 뒤 2배속 60초)'),
    ('skirmish', '쟁탈전 (거점 점령전)'),
    ('campaign', '진영 전역 화면'),
]
for key, label in scenes:
    parts.append(pair(label, '', ROOT / f'before_{key}.wav', ROOT / f'after_{key}.wav'))

# 3. Rendered scripted battle.
parts.append('<h2 id="scripted">3. 연출된 해전 (50초, 오프라인 렌더)</h2><p>같은 각본(원거리 포격, 단발 천자총통, 양현 일제사격, 조총, 근접 포탄, 폭발, 침몰, 충돌, 승선전)을 게임의 battlefield.ts와 녹음 샘플로 렌더했습니다. 후 버전은 바다와 음악 베드까지 같은 배선으로 섞었습니다.</p>')
parts.append(pair('연출된 해전', '', R / 'before_audio2_battle.wav', R / 'after_audio2_battle.wav'))

# 4. Inventory.
parts.append('<h2 id="inventory">4. 모든 소리</h2>')
credits = (REPO / 'public/audio/CREDITS.md').read_text()
desc = {}
for m in re.finditer(r'^\| (\w+\.mp3) \| ([\d.]+ s) \| [\d]+ KB \| (.*?) \| ([\d, ]+|the cannon_\* samples above) \|$', credits, re.M):
    desc[m.group(1)] = (m.group(2), m.group(3), m.group(4))
parts.append('<h3>녹음 샘플 (Freesound CC0 편집본, public/audio)</h3><div class="grid">')
bank = ROOT / 'bank_wav'
bank.mkdir(exist_ok=True)
for mp3 in sorted((REPO / 'public/audio').glob('*.mp3')):
    shutil.copy(mp3, ROOT / 'samples' / mp3.name)
    wav = bank / (mp3.stem + '.wav')
    if not wav.exists():
        subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-i', str(mp3), '-ar', '44100', '-ac', '2', str(wav)], check=True)
    m = analyze.analyze(str(wav), ROOT / 'png')
    d = desc.get(mp3.name, ('', '', ''))
    badge = 'bad' if m['tone_seconds_per_min'] > 60 else 'ok'
    parts.append(f'''<div class="card"><h4>{mp3.name}</h4><p class="note">{html.escape(d[1])} <i>(Freesound {html.escape(d[2])})</i></p>
<audio controls preload="none" src="samples/{mp3.name}"></audio><a href="png/{m['spectrogram']}"><img loading="lazy" src="png/{m['spectrogram']}" alt=""></a>
<dl><dt>길이</dt><dd>{m['seconds']} 초</dd><dt>최대 순간 음량</dt><dd>{m['lufs_max_momentary']} LUFS</dd><dt>피크</dt><dd>{m['peak']:.2f}</dd><dt>순음 길이</dt><dd class="{badge}">{m['tone_seconds_per_min']} 초/분</dd></dl></div>''')
parts.append('</div>')

voices = [
    ('v_cannon_heavy', '합성 대포: 천자총통 (녹음이 디코드되기 전과 일부 실패 시의 대체음)'),
    ('v_cannon_medium', '합성 대포: 현자총통'),
    ('v_cannon_small', '합성 대포: 승자총통'),
    ('v_cannon_far', '합성 대포: 먼 포성(lite)'),
    ('v_drum', '합성 북'),
    ('v_explosion', '합성 폭발'),
    ('v_hit', '합성 명중'),
    ('v_splash', '합성 물보라'),
    ('v_ground', '합성 지면 피탄'),
    ('v_ignite', '합성 점화'),
    ('v_whiz', '합성 스쳐 감'),
    ('v_groan', '합성 선체 삐걱임'),
    ('v_planks', '합성 판자 갈라짐'),
    ('v_mast', '합성 돛대 부러짐'),
    ('v_bubbles', '합성 거품'),
    ('v_gurgle', '합성 침몰의 마지막'),
    ('v_clack', '합성 근접전 타격'),
    ('ui_click', 'UI 클릭 (나무 두드림)'),
    ('music_bed_select', '음악 베드: 메뉴 (드론 + 먼 북, 45초)'),
    ('music_bed_battle', '음악 베드: 전투 중 (더 작게, 45초)'),
    ('ambience_select', '바다·바람: 메뉴 (30초)'),
    ('ambience_battle', '바다·바람: 전투 (30초)'),
    ('ambience_hot', '바다·바람: 격전 + 카메라 이동 (낮은 울림과 바람 소리 최대)'),
]
parts.append('<h3>합성 음원, UI, 음악, 앰비언스 (수정 후)</h3><div class="grid">')
for name, label in voices:
    parts.append(card(label, '', R / f'after_{name}.wav'))
parts.append('</div>')

# 5. Mix table from the offline battle and the bank.
parts.append('<h2 id="mix">5. 음량 정리</h2>')
rows = []
for key, label in scenes:
    for tag in ('before', 'after'):
        f = ROOT / f'{tag}_{key}.wav'
        if f.exists():
            _, m = listen(f)
            rows.append(f'<tr><td>{label}</td><td>{"전" if tag == "before" else "후"}</td><td>{m["lufs_integrated"]}</td><td>{m["lufs_max_momentary"]}</td><td>{m["peak"]:.2f}</td><td>{m["lufs_true_peak"]}</td><td>{m["clipped_samples"]}</td><td>{m["tone_seconds_per_min"]}</td></tr>')
parts.append('<table><thead><tr><th>장면</th><th></th><th>평균 LUFS</th><th>최대 순간 LUFS</th><th>피크</th><th>트루피크 dBTP</th><th>클리핑</th><th>순음 초/분</th></tr></thead><tbody>' + ''.join(rows) + '</tbody></table>')

summary = (ROOT / 'summary.html').read_text() if (ROOT / 'summary.html').exists() else ''
page = f'''<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>임진 해전 소리 점검</title>
<style>
:root{{--bg:#f6f4ef;--fg:#1c2127;--mut:#5d6670;--card:#fff;--line:#d9d5ca;--bad:#a8431d;--ok:#2f6b4f;--acc:#1f4e79}}
@media (prefers-color-scheme:dark){{:root{{--bg:#14181c;--fg:#e8e6e0;--mut:#9aa3ab;--card:#1c2228;--line:#2c353d;--bad:#e0825a;--ok:#6cc39b;--acc:#8ab8e6}}}}
*{{box-sizing:border-box}}body{{margin:0;background:var(--bg);color:var(--fg);font:15px/1.6 -apple-system,"Apple SD Gothic Neo","Noto Sans KR",sans-serif}}
main{{max-width:1180px;margin:0 auto;padding:24px 16px 80px}}h1{{font-size:26px;margin:.2em 0}}h2{{margin-top:2.4em;border-bottom:1px solid var(--line);padding-bottom:6px}}h3{{margin:1.6em 0 .3em}}h4{{margin:0 0 4px;font-size:14px}}
nav a{{margin-right:14px;color:var(--acc)}}p{{max-width:70ch}}.note{{color:var(--mut);font-size:13px;margin:0 0 6px}}
.cols,.grid{{display:grid;gap:14px;grid-template-columns:repeat(auto-fill,minmax(340px,1fr))}}.cols{{grid-template-columns:repeat(auto-fit,minmax(340px,1fr))}}
.card{{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px}}audio{{width:100%;margin:4px 0}}img{{width:100%;height:auto;border-radius:6px;display:block}}
dl{{display:grid;grid-template-columns:1fr auto;gap:2px 10px;margin:8px 0 0;font-size:12.5px}}dt{{color:var(--mut)}}dd{{margin:0;text-align:right;font-variant-numeric:tabular-nums}}.bad{{color:var(--bad);font-weight:600}}.ok{{color:var(--ok)}}
table{{border-collapse:collapse;width:100%;font-size:13px;font-variant-numeric:tabular-nums}}th,td{{border-bottom:1px solid var(--line);padding:5px 8px;text-align:right}}th:first-child,td:first-child{{text-align:left}}
.sum{{background:var(--card);border:1px solid var(--line);border-left:4px solid var(--acc);border-radius:8px;padding:6px 18px 12px}}.sum li{{margin:.3em 0}}
</style></head><body><main>
<h1>임진 해전 소리 점검</h1>
<nav><a href="#beeps">삐비빅</a><a href="#play">실제 플레이</a><a href="#scripted">연출 해전</a><a href="#inventory">모든 소리</a><a href="#mix">음량</a></nav>
{summary}
{''.join(parts)}
</main></body></html>'''
(ROOT / 'index.html').write_text(page)
print('wrote', ROOT / 'index.html', len(page) // 1024, 'KB')
