"""Build src/training/bank.json from the Shoals Product Academy data (dist/*.json).

Usage: python3 -I scripts/build-bank.py <path to academy dist/>
Only facts that make good drill questions are kept; no PDFs, book or inventory copy.
"""
import json, re, sys, os

src = sys.argv[1]
load = lambda f: json.load(open(os.path.join(src, f)))
specs, catalog, lessons, inv = load('specs.json'), load('catalog.json'), load('lessons.json'), load('inventory.json')

# Polaris product-line facts and 2026-book numbers (from the academy's arcade).
MATCH = [
 ('Sportsman','Recreation / utility straddle-seat ATV family'),('RANGER','Utility side-by-side family'),('RZR','Sport side-by-side family'),('GENERAL','Crossover side-by-side with a dumping cargo box'),('XPEDITION XP','Open rear cargo box with dumping capability'),('XPEDITION ADV','Covered pass-through rear cargo space'),('EPS','Electronic power steering'),('STEELDRIVE','Sealed, liquid-cooled transmission with a steel belt'),
 ('RANGER 500','Mid-size RANGER with 28 hp and 1,500-lb towing'),('RANGER SP 570','Mid-size RANGER platform with 570-class power'),('RANGER 1000','Full-size RANGER listed at 61 hp'),('RANGER XP 1000','Full-size RANGER listed at 82 hp'),('RANGER XD 1500','Extreme-duty RANGER using STEELDRIVE'),('RANGER XP KINETIC','Electric RANGER line'),('RZR TRAIL','Narrow trail-oriented RZR branch'),('RZR TRAIL S','Trail S branch of the RZR lineup'),('RZR Pro XP','64-inch, 181-hp RZR platform'),('RZR Pro S','74-inch, 181-hp RZR platform'),('RZR Pro R','Wide-open RZR branch'),('GENERAL 1000','100-hp GENERAL overview model'),('GENERAL XP 1000','100-hp GENERAL with 13.5-inch clearance'),('Sportsman Touring 570','Two-seat ATV branch with passenger seat system'),('Sportsman 850','Recreation/utility ATV branch'),('Scrambler','Sportsman-line sport ATV branch'),('Sportsman X2 570','Special-edition two-rider ATV branch'),('Sportsman 6x6 570','Six-wheel special-edition ATV branch'),('Outlaw 70 EFI','Youth ATV model'),('Outlaw 110 EFI','Youth ATV model'),('Phoenix 200','Youth ATV model'),('RZR 200 EFI','Youth side-by-side model'),('CREW','Longer passenger configuration marker'),('NorthStar','Cab-equipped trim naming used across families'),('Premium','Polaris trim name used in multiple model tables'),('Ultimate','Higher equipment trim in several tables'),
]
BOOK = [
 ('RANGER 1000','Horsepower',61,'hp'),('RANGER XP 1000','Horsepower',82,'hp'),('RZR Pro XP','Horsepower',181,'hp'),('RZR Pro S','Horsepower',181,'hp'),('GENERAL 1000','Horsepower',100,'hp'),('GENERAL XP 1000','Horsepower',100,'hp'),('Sportsman 570','Horsepower',44,'hp'),('RZR Pro XP','Width',64,'in'),('RZR Pro S','Width',74,'in'),('GENERAL 1000','Width',62.5,'in'),('GENERAL XP 1000','Width',64,'in'),('GENERAL 1000','Ground Clearance',12,'in'),('GENERAL XP 1000','Ground Clearance',13.5,'in'),('RZR Pro S','Ground Clearance',16,'in'),('RANGER 500','Towing Capacity',1500,'lb'),('RANGER 500','Cargo Box Capacity',300,'lb'),('RANGER SP 570','Towing Capacity',1500,'lb'),('RANGER 1000','Towing Capacity',2500,'lb'),('RANGER XP 1000','Towing Capacity',2500,'lb'),('RANGER XD 1500','Towing Capacity',3500,'lb'),('RANGER XD 1500','Horsepower',110,'hp'),('RANGER XP KINETIC','Horsepower',110,'hp'),
]

proper = {x['name'].lower(): x['name'] for x in inv}
cat_of = {x['name'].lower(): x['cat'] for x in inv}
BRANDS = {'polaris':'Polaris','ranger':'RANGER','rzr':'RZR','general':'GENERAL','xpedition':'XPEDITION','eps':'EPS','xp':'XP','xd':'XD','hd':'HD','sp':'SP','efi':'EFI','sxsb':'SXSB','sx':'SX','ob':'OB','xl':'XL','pro':'Pro','sportsman':'Sportsman'}
def title(name):
    return re.sub(r'\b(\w+) \1\b', r'\1', title0(name), flags=re.I)   # "Polaris Polaris XPEDITION"

def title0(name):
    if name in proper: return proper[name]
    return ' '.join(BRANDS.get(w, w.upper() if re.fullmatch(r'[a-z]{1,2}\d*|\d+[a-z]+', w) and not w.isdigit() else w[:1].upper()+w[1:]) for w in name.split())

def category(name):
    c = cat_of.get(name)
    if c: return {'Trailers & accessories':'Trailers'}.get(c, c)
    if 'polaris' in name: return 'Polaris'
    if re.search(r'mercury', name): return 'Mercury'
    if re.search(r'bennington|hurricane|lowe|caymas|bayliner|alumacraft|tracker', name): return 'Boats'
    if re.search(r'trailer|grey states|big tex|carry-on|utility \d|\d+x\d+', name): return 'Trailers'
    if re.search(r'cub cadet|husqvarna|toro|mower|zero|kawasaki|briggs|dewalt', name): return 'Mowers'
    return 'Equipment'

# What customers actually ask about, by product line (the rest can be looked up later).
ASK = {
    'Polaris': {'Horsepower', 'Towing Capacity', 'Cargo Box Capacity', 'Capacity', 'Seating', 'Displacement', 'Width', 'Ground Clearance'},
    'Boats': {'Seating Capacity', 'Seating', 'Power', 'Horsepower', 'Length', 'Dry Weight', 'Maximum Load Capacity', 'Load Capacity'},
    'Mercury': {'Power', 'Horsepower', 'Dry Weight', 'Starting', 'Displacement'},
    'Mowers': {'Cutting Width', 'Horsepower', 'Engine Make', 'Power'},
    'Trailers': {'Load Capacity', 'Capacity', 'Maximum Load Capacity'},
    'Equipment': {'Horsepower', 'Power', 'Displacement', 'Capacity'},
}
NUMERIC = {'Horsepower','Displacement','Towing Capacity','Cargo Box Capacity','Ground Clearance','Width','Length','Dry Weight','Load Capacity','Maximum Load Capacity','Power','Cutting Width','Capacity','Seating','Seating Capacity'}
LABEL = {'Capacity': 'payload capacity', 'Seating': 'seating (how many people)', 'Seating Capacity': 'seating (how many people)', 'Power': 'horsepower', 'Starting': 'starting (electric or manual)', 'Displacement': 'engine size', 'Width': 'width (trail fit)', 'Dry Weight': 'dry weight', 'Maximum Load Capacity': 'max load', 'Load Capacity': 'load capacity'}
TRIM = re.compile(r'\b(northstar|premium|ultimate|trail boss|edition|mud|light tint|cab|crew|sport|eps|high lifter|hunter|ride command|le|se|ps|camo)\b|-.*$', re.I)

ASKED = {
    'Horsepower': 'How much horsepower does the {t} make?', 'Power': 'How much horsepower does the {t} make?',
    'Towing Capacity': 'How much can the {t} tow?', 'Cargo Box Capacity': "How much does the {t}'s cargo box hold?",
    'Capacity': 'What is the total payload of the {t}?', 'Seating': 'How many people does the {t} seat?', 'Seating Capacity': 'How many people does the {t} seat?',
    'Displacement': 'What is the engine size (cc) of the {t}?', 'Width': 'How wide is the {t}? (Will it fit the trail?)',
    'Ground Clearance': 'How much ground clearance does the {t} have?', 'Length': 'How long is the {t}?', 'Dry Weight': 'How much does the {t} weigh (dry)?',
    'Starting': 'Is the {t} electric start or manual?', 'Cutting Width': 'How wide does the {t} cut?', 'Engine Make': 'Whose engine is in the {t}?',
    'Maximum Load Capacity': 'How much can the {t} carry (max load)?', 'Load Capacity': 'How much can the {t} carry?',
}

def clean(v):
    v = re.sub(r'\s*\([^)]*\b(cm|kg|l|mm|kw|m)\)', '', v)       # drop metric in parentheses
    v = re.sub(r'^(Overall|Payload|Total)\s*-\s*', '', v)
    v = re.sub(r'^[A-Za-z][A-Za-z ]{1,30}\s-\s(?=\d)', '', v)   # "Deck - 54 in." → "54 in."
    v = re.split(r';\s|(?<=[a-z])Type\s*-|\s+-\s+(?=[A-Z][a-z]+ -)', v)[0]   # first part only ("2,500 lb.; Winch - …")
    v = re.sub(r'(?i)\b(\d+) person capacity\b.*', lambda m: m.group(1) + (' person' if m.group(1) == '1' else ' people'), v)
    v = re.sub(r'\b(in|lb|lbs|gal)\b(?!\.)', lambda m: ('lb' if m.group(1) == 'lbs' else m.group(1)) + '.', v)   # "64 in" → "64 in."
    return v.strip().rstrip(';').strip()

def number(v):
    m = re.search(r'(\d[\d,]*\.?\d*)', v)
    return float(m.group(1).replace(',', '')) if m else None

cards = []
def add(**c): cards.append(c)

for f,(name,ans) in enumerate(MATCH):
    add(id=f'line-{f}', cat='Product line', topic=name, kind='type', q=f'Which Polaris family, model or term is this: {ans}?', a=name, field='Product line', why=f'{name} = {ans}.')
for i,(model,field,val,unit) in enumerate(BOOK):
    v = f'{val:,g} {unit}'
    add(id=f'book-{i}', cat='Polaris', topic=model, kind='type', q=ASKED.get(field, 'What is the {l} of the {t}?').format(t=model, l=LABEL.get(field, field.lower())), a=v, num=val, field=field, why=f'The 2026 Polaris book lists {model}: {field.lower()} {v}.')

# One question per (model family, fact, answer): trims that share a spec are asked once.
merged = {}
for name, d in specs.items():
    model, cat = title(name), category(name)
    for field, raw in d['facts']:
        if field not in ASK.get(cat, set()): continue
        v = clean(raw)
        if not v or len(v) > 70: continue
        n = number(v) if field in NUMERIC else None
        if field in NUMERIC and n is None: continue
        if field in ('Seating', 'Seating Capacity'):
            v = f"{n:g} {'person' if n == 1 else 'people'}"
        if field == 'Capacity' and 'lb' not in v.lower(): continue
        base = re.sub(r'\s+', ' ', TRIM.sub('', model)).strip()
        key = (base.lower(), field, v.lower())
        m = merged.setdefault(key, {'models': [], 'cat': cat, 'field': field, 'v': v, 'n': n, 'src': d.get('source')})
        m['models'].append(model)
for (base, field, _), m in merged.items():
    models = sorted(set(m['models']), key=len)
    topic = models[0] if len(models) == 1 else re.sub(r'\s+', ' ', TRIM.sub('', models[0])).strip() + ' (every trim)'
    label = LABEL.get(field, field.lower())
    add(id=f'spec-{base}-{field}-{m["v"]}', cat=m['cat'], topic=topic, kind='type' if m['n'] is not None else 'choice', q=ASKED.get(field, 'What is the {l} of the {t}?').format(t=topic, l=label), a=m['v'], **({'num': m['n']} if m['n'] is not None else {}), field=field, why=f'{topic}: {label} {m["v"].rstrip(".")}.' + (f' Same on: {", ".join(models[1:4])}{"…" if len(models) > 4 else ""}.' if len(models) > 1 else ''), src=m['src'])

for r in catalog['rows']:
    label = r['variant'] + (f" ({r['color']})" if r.get('color') and r['color'].lower() not in r['variant'].lower() else '')
    if r.get('msrp'):
        add(id=f"cat-msrp-{r['id']}", cat='MY27 pricing', topic=r['family'], kind='choice', q=f'2027 price sheet: what is the MSRP of the {label}?', a=f"${r['msrp']:,}", num=r['msrp'], field='MSRP ' + r['family'], why=f"{label}: ${r['msrp']:,} MSRP" + (f" plus ${r['freight']:,} freight" if r.get('freight') else '') + ' on the MY27 price sheet. Prices change; check the current sheet before quoting.')

for l in lessons:
    add(id=f"lesson-{l['id']}", cat='Lessons', topic=l['title'], kind='flash', q=l['recall'], a=l['answer'], field='Lesson', why=' '.join([l['hook'] + '.'] + l.get('points', [])), src=l.get('source'))

seen = set(); out = []
for c in cards:
    c['id'] = re.sub(r'[^a-z0-9_.-]+', '_', c['id'].lower())   # safe as a storage key
    if c['id'] in seen: continue
    seen.add(c['id']); out.append(c)
json.dump({'version': 1, 'source': 'Shoals Product Academy data', 'cards': out}, open(os.path.join(os.path.dirname(__file__), '..', 'src', 'training', 'bank.json'), 'w'), separators=(',', ':'))
from collections import Counter
print(len(out), 'cards', Counter(c['cat'] for c in out), Counter(c['kind'] for c in out))
