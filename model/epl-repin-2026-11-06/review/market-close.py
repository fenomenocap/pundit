# Reviewer script: dev-sample 1X2 log loss of baseline, T=1.286 and de-margined Pinnacle close (football-data PSCH/PSCD/PSCA, proportional de-vig)
# Run: python3 model/epl-repin-2026-11-06/review/market-close.py
import csv, json, math, random
import os
D=os.path.join(os.path.dirname(os.path.abspath(__file__)), '..') + '/'
b=json.load(open(D+'backtest-predictions.json'))
close={}
for s in ['2425','2526']:
    for r in csv.DictReader(open(D+f'raw/E0-{s}.csv',encoding='utf-8-sig')):
        try: o=[float(r['PSCH']),float(r['PSCD']),float(r['PSCA'])]
        except: continue
        inv=[1/x for x in o]; t=sum(inv)
        d,mo,y=r['Date'].split('/')
        close[(f'{y}-{mo}-{d}',r['HomeTeam'].replace("Nott'm Forest","Forest"),r['AwayTeam'].replace("Nott'm Forest","Forest"))]=[x/t for x in inv]
rows=[]
for base,win in zip(b['developmentBaseline'],b['developmentWinner']):
    assert base['id']==win['id']
    # id carries London-date? use id date (UTC date) and fallback +-1
    parts=base['id'].split(':'); date=parts[3]
    k=None
    for dd in [date]:
        if (dd,base['home'],base['away']) in close: k=(dd,base['home'],base['away'])
    if k is None:
        cands=[c for c in close if c[1]==base['home'] and c[2]==base['away'] and abs((__import__('datetime').date.fromisoformat(c[0])-__import__('datetime').date.fromisoformat(date)).days)<=1]
        k=cands[0] if cands else None
    if k is None: continue
    r=base['result']
    rows.append((-math.log(base['oneXTwo'][r]),-math.log(win['oneXTwo'][r]),-math.log(close[k][r])))
n=len(rows); m=lambda i:sum(x[i] for x in rows)/n
print('n with close',n,'of',len(b['developmentBaseline']))
print('baseline %.4f  T1.286 %.4f  close %.4f'%(m(0),m(1),m(2)))
random.seed(1)
def ci(i):
    ds=[]
    for _ in range(2000):
        s=[rows[random.randrange(n)] for _ in range(n)]
        ds.append(sum(x[i]-x[2] for x in s)/n)
    ds.sort(); return sum(x[i]-x[2] for x in rows)/n, ds[50], ds[1949]
print('baseline-close %.4f [%.4f, %.4f]'%ci(0)); print('T-close %.4f [%.4f, %.4f]'%ci(1))
