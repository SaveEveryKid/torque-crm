"""Build src/training/audio.json: a narrated product course to listen to.

Usage: python3 -I scripts/build-audio.py <path to academy dist/>
Uses the cleaned question bank (src/training/bank.json) for the numbers and
the academy lessons for the teaching. Each episode: what the line is for,
the lineup smallest to biggest, comparisons, memory hooks, a spoken quiz.
"""
import json, os, re, sys
from collections import OrderedDict, defaultdict

here = os.path.dirname(os.path.abspath(__file__))
bank = json.load(open(os.path.join(here, '..', 'src', 'training', 'bank.json')))['cards']
lessons = {l['title']: l for l in json.load(open(os.path.join(sys.argv[1], 'lessons.json')))}

# ---------- speaking ----------
def say(s):
    s = s.replace('®', '').replace('™', '').replace('w/', 'with ').replace('&', 'and').replace('MY27', 'model year 2027')
    # "in." is inches; a bare "in" after a number only at the very end ("64 in"), never "570 in the…".
    s = re.sub(r'(\d[\d,.]*)\s*in\.', r'\1 inches', s)
    s = re.sub(r'(\d[\d,.]*)\s*in$', r'\1 inches', s)
    s = re.sub(r'(\d[\d,.]*)\s*lb\.?(?=\W|$)', r'\1 pounds', s)
    s = re.sub(r'(\d[\d,.]*)\s*gal\.?(?=\W|$)', r'\1 gallons', s)
    s = re.sub(r'(\d[\d,.]*)\s*hp\b', r'\1 horsepower', s)
    s = re.sub(r'(\d[\d,.]*)\s*cc\b', r'\1 C C', s)
    s = re.sub(r'\bEPS\b', 'E P S', s)
    s = re.sub(r'\bEFI\b', 'E F I', s)
    s = re.sub(r'\bPVT\b', 'P V T', s)
    s = re.sub(r'\bH\.O\.', 'H O', s)
    s = re.sub(r'\b4x4\b', 'four by four', s)
    s = re.sub(r'\s+', ' ', s).strip()
    return s

def model_name(topic):
    t = re.sub(r'^\d{4}\s+', '', topic)
    t = re.sub(r'^(Polaris|Mercury Marine)\s+', '', t)
    t = t.replace(' (every trim)', '')
    t = re.sub(r'\s*(NorthStar )?Texas( Edition)?\b', '', t)
    for a, b in [('Ranger', 'RANGER'), ('Rzr', 'RZR'), ('RZR PRO', 'RZR Pro'), ('General', 'GENERAL'), ('Xpedition', 'XPEDITION')]:
        t = re.sub(r'\b' + a + r'\b', b, t)
    return t.strip()

def year(topic):
    m = re.match(r'(\d{4})', topic)
    return int(m.group(1)) if m else 2026

# ---------- facts per model ----------
SPEC_CATS = {'Polaris', 'Boats', 'Mercury', 'Mowers'}
models = defaultdict(dict)        # name -> field -> answer
model_year = {}
for c in bank:
    if c['cat'] not in SPEC_CATS: continue
    name = model_name(c['topic'])
    y = year(c['topic']) if re.match(r'\d{4}', c['topic']) else 0
    # Prefer the newest model year's number; the 2026 book numbers fill gaps.
    if c['field'] in models[name] and model_year.get((name, c['field']), 0) >= y: continue
    models[name][c['field']] = c['a']
    model_year[(name, c['field'])] = y

def num(a):
    m = re.search(r'(\d[\d,]*\.?\d*)', a or '')
    return float(m.group(1).replace(',', '')) if m else 0

def join(xs):
    return xs[0] if len(xs) == 1 else ', '.join(xs[:-1]) + ' and ' + xs[-1]

def describe(name, f):
    """A few spoken sentences about a model, in the order a customer asks."""
    out = [f"The {name}."]
    hp = f.get('Horsepower') or f.get('Power')
    if hp and 'Displacement' in f: out.append(f"{hp} from a {f['Displacement']} engine.")
    elif hp: out.append(f"{hp}.")
    elif 'Displacement' in f: out.append(f"A {f['Displacement']} engine.")
    does = []
    if 'Seating' in f: does.append(f"seats {f['Seating'].replace(' people', '').replace(' person', '')}")
    if 'Seating Capacity' in f: does.append(f"holds {f['Seating Capacity']}")
    if 'Towing Capacity' in f: does.append(f"tows {f['Towing Capacity']}")
    if 'Cargo Box Capacity' in f: does.append(f"carries {f['Cargo Box Capacity']} in the box")
    if 'Capacity' in f: does.append(f"has a total payload of {f['Capacity']}")
    if 'Maximum Load Capacity' in f: does.append(f"has a max load of {f['Maximum Load Capacity']}")
    if does: out.append(f"It {join(does)}.")
    size = [f"{f[k]} {w}" for k, w in (('Width', 'wide'), ('Length', 'long')) if k in f]
    if size and 'Ground Clearance' in f: out.append(f"It's {join(size)}, with {f['Ground Clearance']} of ground clearance.")
    elif size: out.append(f"It's {join(size)}.")
    elif 'Ground Clearance' in f: out.append(f"It has {f['Ground Clearance']} of ground clearance.")
    if 'Dry Weight' in f: out.append(f"It weighs {f['Dry Weight']} dry.")
    has = []
    if 'Steering' in f: has.append('power steering' if f['Steering'].startswith('Yes') else 'no power steering')
    if 'Transmission' in f and 'STEELDRIVE' in f['Transmission']: has.append('the sealed STEELDRIVE transmission')
    shape = {'V-hull (modified vee)': 'modified-V', 'Pontoon': 'pontoon'}.get(f.get('Hull Shape', ''), f.get('Hull Shape', '').lower())
    if 'Hull Material' in f and shape: has.append(f"{'an' if f['Hull Material'][0] in 'AEIOU' else 'a'} {f['Hull Material'].lower()} {shape} hull")
    elif 'Hull Material' in f: has.append(f"{'an' if f['Hull Material'][0] in 'AEIOU' else 'a'} {f['Hull Material'].lower()} hull")
    if 'Starting' in f: has.append(f"{f['Starting'].lower()} start")
    if 'Cutting Width' in f: has.append(f"a {f['Cutting Width']} cut")
    if 'Engine Make' in f: has.append(f"a {f['Engine Make'].replace('®', '')} engine")
    if 'Deck Construction' in f: has.append(f"a {f['Deck Construction'].lower()} deck")
    if has: out.append(f"It has {join(has)}.")
    fuel = f.get('Fuel Capacity') or f.get('Fuel Tank Capacity')
    if fuel: out.append(f"The tank holds {fuel} of gas.")
    if 'Warranty' in f: out.append(f"Warranty: {f['Warranty']}.")
    return say(' '.join(out))

# ---------- episodes ----------
def lesson_text(title):
    l = lessons.get(title)
    if not l: return []
    out = [say(l['overview'])]
    out += [say(p) for p in l.get('points', [])]
    out.append(say(f"Remember it like this: {l['hook']}."))
    return out

def colors_for(pattern):
    out = []
    for c in bank:
        if c['cat'] == 'Colors' and re.search(pattern, c['topic'], re.I) and c['why'] not in out:
            out.append(c['why'])
    return [say(w.replace('The 2027 ', 'For 2027, the ')) for w in out]

UNIT = {'Horsepower': 'horsepower', 'Power': 'horsepower', 'Towing Capacity': 'pounds', 'Cargo Box Capacity': 'pounds', 'Capacity': 'pounds',
        'Ground Clearance': 'inches', 'Width': 'inches', 'Length': 'inches', 'Seating': 'people', 'Seating Capacity': 'people', 'Fuel Capacity': 'gallons', 'Dry Weight': 'pounds'}
ASKS = {'Horsepower': 'Who makes the most power?', 'Power': 'Who makes the most power?', 'Towing Capacity': 'Who tows the most?', 'Cargo Box Capacity': 'Who has the biggest cargo box?',
        'Capacity': 'Who carries the most payload?', 'Ground Clearance': 'Who has the most ground clearance?', 'Width': "Who's narrowest for tight trails?", 'Length': "Who's longest?",
        'Seating': 'Who seats the most?', 'Seating Capacity': 'Who holds the most people?', 'Fuel Capacity': 'Who holds the most gas?', 'Dry Weight': "Who's lightest?"}

def compares_for(pattern, fam):
    out, fields = [], set()
    for c in bank:
        f = c['field'].replace('Compare ', '')
        if c['cat'] != 'Compare' or c['topic'] != fam or f in fields or f not in ASKS: continue
        fields.add(f)
        pairs = re.findall(r'([^;]+?): ([\d,.]+)', re.sub(r'\s*\([^)]*\)\.?$', '', c['why']))
        if f in ('Width', 'Dry Weight'): pairs = pairs[::-1]
        if len(pairs) < 2: continue
        named, uniq = set(), []
        for nm, v in pairs:
            if model_name(nm.strip()) not in named: named.add(model_name(nm.strip())); uniq.append((nm, v))
        if len(uniq) < 2: continue
        first, rest = uniq[0], uniq[1:]
        line = f"{ASKS[f]} The {model_name(first[0].strip())}, at {first[1]} {UNIT[f]}. " + 'Then ' + join([f"the {model_name(n.strip())} at {v}" for n, v in rest]) + '.'
        out.append(say(line))
    return out

def quiz_for(match, n=6):
    picks, topics = [], set()
    for c in bank:
        if not match(c) or c['kind'] == 'flash' or c['topic'] in topics: continue
        topics.add(c['topic'])
        picks.append(c)
        if len(picks) >= n: break
    return picks

def lineup(match):
    names = [n for n in models if match(n) and len(models[n]) >= 4]
    # Trims with exactly the same numbers as a shorter name: say it once.
    seen, keep = {}, []
    for n in sorted(names, key=len):
        key = json.dumps({k: v for k, v in models[n].items() if k != 'Warranty'}, sort_keys=True)
        if key in seen: continue
        seen[key] = n
        keep.append(n)
    names = keep
    # Full write-ups smallest to biggest (by power); trims without a power figure after them.
    size = lambda n: num(models[n].get('Horsepower') or models[n].get('Power') or models[n].get('Displacement') or '0')
    return sorted(names, key=lambda n: (size(n) == 0, size(n), n))

episodes = []
def episode(eid, title, intro, sections):
    segs = [{'t': say(intro)}]
    for heading, paras, kind in sections:
        if not paras: continue
        segs.append({'t': say(heading), 'h': True})
        for p in paras:
            if kind == 'quiz':
                segs.append({'t': say('Question. ' + p['q']), 'pause': 4})
                segs.append({'t': say('Answer: ' + p['a'] + '.')})
            else:
                segs.append({'t': p})
    words = sum(len(s['t'].split()) for s in segs)
    episodes.append({'id': eid, 'title': title, 'minutes': max(1, round(words / 150 + sum(s.get('pause', 0) for s in segs) / 60)), 'segments': segs})

POL = lambda pat: (lambda n: re.search(pat, n, re.I) and not re.search(r'Outlaw|Phoenix|110 EFI|150 EFI|200 EFI', n))

episode('intro', 'Start here: how to read a Polaris model name',
        "Welcome to Torque product training. In this first episode: how to read a model name, what the trims mean, and the three numbers customers ask about most.",
        [('Decoding a model name', lesson_text('Decode a model name'), 'p'),
         ('E P S, cab and NorthStar', lesson_text('EPS, cab & NorthStar'), 'p'),
         ('Towing, payload and the cargo box', lesson_text('Towing, payload & cargo box'), 'p'),
         ('Reading a spec sheet', lesson_text('Read a specification'), 'p'),
         ('Identifying a unit on the lot', lesson_text('Identify a unit'), 'p')])

FAMS = [
    ('ranger', 'RANGER: the work side-by-side', 'RANGER', r'^RANGER', 'RANGER', r'^RANGER'),
    ('rzr', 'RZR: the sport side-by-side', 'RZR', r'^RZR', 'RZR', r'^RZR'),
    ('general', 'GENERAL: work and play', 'GENERAL', r'^GENERAL', 'GENERAL', r'^GENERAL'),
    ('xpedition', 'XPEDITION: the adventure side-by-side', 'XPEDITION', r'^XPEDITION', 'XPEDITION', r'^XPEDITION'),
    ('sportsman', 'Sportsman: the ATV lineup', 'Sportsman', r'^(Sportsman|Scrambler)', 'Sportsman', r'^(Sportsman|Scrambler)'),
]
for eid, title, lesson, pat, fam, colorpat in FAMS:
    names = lineup(POL(pat))
    episode(eid, title, f"This episode is the {fam} family: what it's for, every model smallest to biggest, the comparisons customers make, and a quick quiz.",
            [(f'What {fam} is for', lesson_text(lesson), 'p'),
             ('The lineup, smallest to biggest', [describe(n, models[n]) for n in names], 'p'),
             ('Quick comparisons', compares_for(pat, fam) + compares_for(pat, 'side-by-side')[:0], 'p'),
             ('Colors', colors_for(colorpat)[:10], 'p'),
             ("Quiz yourself. I'll ask, pause, then answer.", quiz_for(lambda c: c['cat'] == 'Polaris' and re.search(pat, model_name(c['topic']), re.I)), 'quiz')])

youth = lineup(lambda n: re.search(r'Outlaw|Phoenix|110 EFI|150 EFI|200 EFI', n))
episode('youth', 'Youth models and Scrambler', "Youth ATVs and side-by-sides: the right size for the right rider, plus the Scrambler sport ATV.",
        [('The youth lineup', lesson_text('Scrambler & youth'), 'p'),
         ('Model by model', [describe(n, models[n]) for n in youth], 'p'),
         ('Colors', colors_for(r'Outlaw|Phoenix|110 EFI|150 EFI|200 EFI'), 'p'),
         ('Quiz yourself', quiz_for(lambda c: c['cat'] == 'Polaris' and re.search(r'Outlaw|Phoenix|110 EFI|150 EFI|200 EFI', c['topic'])), 'quiz')])

episode('sxs-compare', 'Side-by-side showdown: which one for which customer', "Across all the side-by-sides: who tows the most, who's narrowest for tight trails, who carries the most. These are the questions that decide a sale.",
        [('Across the families', compares_for(r'.', 'side-by-side'), 'p'),
         ('Fifty-inch trails', [say("If a customer rides fifty-inch trails, only the narrow machines fit. Anything sixty inches or wider won't. Ask where they ride before you show anything.")], 'p'),
         ('Quiz yourself', quiz_for(lambda c: c['cat'] == 'Compare' and c['topic'] == 'side-by-side', 8), 'quiz')])

boat = lambda pat: (lambda n: re.search(pat, n, re.I))
episode('pontoons', 'Pontoons and Bennington', "Pontoons and tritoons, and how to read a Bennington model name.",
        [('Pontoon versus tritoon', lesson_text('Pontoon & tritoon'), 'p'),
         ('Bennington model names', lesson_text('Bennington model names'), 'p'),
         ('Boat dimensions and capacity', lesson_text('Boat dimensions & capacity'), 'p'),
         ('The boats', [describe(n, models[n]) for n in lineup(boat(r'Bennington'))], 'p'),
         ('Quiz yourself', quiz_for(lambda c: c['cat'] == 'Boats' and 'Bennington' in c['topic']), 'quiz')])
episode('fishing', 'Fishing, deck and bowrider boats', "Lowe fishing boats, bass boats, deck boats and bowriders: who each one is for.",
        [('Bass boats', lesson_text('Bass boat'), 'p'),
         ('Lowe fishing models', lesson_text('Lowe fishing models'), 'p'),
         ('Deck boats', lesson_text('Deck boat'), 'p'),
         ('Bowriders', lesson_text('Bowrider'), 'p'),
         ('What comes in a boat package', lesson_text('Boat package components'), 'p'),
         ('The boats', [describe(n, models[n]) for n in lineup(boat(r'Lowe|Hurricane|Bayliner|Caymas'))], 'p'),
         ('Quiz yourself', quiz_for(lambda c: c['cat'] == 'Boats' and 'Bennington' not in c['topic']), 'quiz')])
episode('mercury', 'Mercury outboards', "Mercury outboards: the basics, FourStroke versus Pro XS, shaft length, props, and the portables.",
        [('Outboard basics', lesson_text('Outboard fundamentals'), 'p'),
         ('FourStroke and Pro XS', lesson_text('FourStroke & Pro XS'), 'p'),
         ('Shaft length and rigging', lesson_text('Shaft length & rigging'), 'p'),
         ('Props and performance', lesson_text('Propeller & performance'), 'p'),
         ('Portables and ProKicker', lesson_text('Portable & ProKicker'), 'p'),
         ('The motors', [describe(n, models[n]) for n in lineup(boat(r'^(\d|Mercury)'))], 'p'),
         ('Quiz yourself', quiz_for(lambda c: c['cat'] == 'Mercury'), 'quiz')])
episode('mowers', 'Mowers and power equipment', "Mowers: tractor versus zero-turn, the Cub Cadet and Husqvarna names, and how they're built.",
        [('Tractor or zero-turn?', lesson_text('Tractor versus zero-turn'), 'p'),
         ('Cub Cadet names', lesson_text('Cub Cadet rider & zero-turn names'), 'p'),
         ('Cub Cadet XT1 LT42', lesson_text('Cub Cadet XT1 LT42'), 'p'),
         ('Husqvarna Z 275X', lesson_text('Husqvarna Z 275X'), 'p'),
         ('How mowers are built', lesson_text('Mower construction & drivetrain'), 'p'),
         ('Handheld equipment', lesson_text('Handheld equipment'), 'p'),
         ('The mowers', [describe(n, models[n]) for n in lineup(boat(r'Cub Cadet|Husqvarna'))], 'p'),
         ('Quiz yourself', quiz_for(lambda c: c['cat'] == 'Mowers'), 'quiz')])
episode('trailers', 'Trailers and accessories', "Trailers and accessories: reading a trailer spec and making sure accessories fit.",
        [('Trailer specs', lesson_text('Trailer specifications'), 'p'),
         ('Accessory fit', lesson_text('Accessory compatibility'), 'p')])

json.dump({'version': 1, 'episodes': episodes}, open(os.path.join(here, '..', 'src', 'training', 'audio.json'), 'w'), separators=(',', ':'))
print(len(episodes), 'episodes', sum(e['minutes'] for e in episodes), 'minutes')
for e in episodes: print(f"  {e['minutes']:>3} min  {e['title']}  ({len(e['segments'])} parts)")
