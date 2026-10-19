import json
B=json.load(open('fjt_base.json')); V=json.load(open('fjt_variants.json'))
def path(pts,**a): return '<polygon points="%s" %s/>'%(' '.join('%.2f,%.2f'%(x,-y) for x,y in pts),' '.join('%s="%s"'%(k.replace('_','-'),v) for k,v in a.items()))
out=[]
for v in V+[{'key':'base','label':'','blocks':[]}]:
  g=[path(B['par'],fill='none',stroke='#000',stroke_width=.4),path(B['sidr'],fill='#ccf',stroke='#00f',stroke_width=.3),path(B['fjt'],fill='#dfd',stroke='#080',stroke_width=.3),path(B['env'],fill='none',stroke='orange',stroke_width=.4,stroke_dasharray='1 1')]
  g+= [path(b,fill='red',opacity=.5) for b in B['b2u']]
  if B['serv']: g.append(path(B['serv'],fill='cyan',opacity=.5))
  for bl in v['blocks']: g.append(path(bl['poly'],fill='#444'))
  if v.get('parking'): g.append(path(v['parking'],fill='#999',opacity=.7))
  out.append('<div style="display:inline-block;margin:4px;font:12px sans-serif">%s %s<br><svg width="520" height="420" viewBox="-60 -45 120 90">%s</svg></div>'%(v['key'],v['label'],''.join(g)))
open('debug.html','w').write('<body style="margin:0">'+''.join(out)+'</body>')
