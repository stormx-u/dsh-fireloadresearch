"""Local self-contained report export; no network assets."""
from pathlib import Path
from io import BytesIO, StringIO
import base64
import csv
import html
import json
import zipfile
import numpy as np
from PIL import Image
from analysis import CN, COLORS, Result, render_overlay

def png_bytes(im):
    stream=BytesIO();im.save(stream,format='PNG');return stream.getvalue()


def _review_origin(part):
    if part.review in {'model_accepted','model_rejected','model_uncertain'}:return 'model_review'
    if part.review in {'accepted','rejected'} or part.source=='manual':return 'human_review'
    return 'segmentation_model'


def _review_label(part):
    return {'model':'分割模型估计','pending':'尚未判明的金属候选','accepted':'人工确认','rejected':'人工忽略',
            'model_accepted':'AI模型确认','model_rejected':'AI模型排除','model_uncertain':'AI未能判明，保持未知'}.get(part.review,'未记录')


def _metal_text(result,ai):
    accepted=[p for p in result.parts if p.label=='metal' and p.review in {'accepted','model_accepted'}]
    model=any(p.review=='model_accepted' for p in accepted);human=any(p.review=='accepted' for p in accepted)
    if model or human:
        source='AI模型与人工分别' if model and human else ('AI模型' if model else '人工')
        return '金属：'+source+'确认存在可见金属区域；仅使用已有分割或标注掩膜。'
    if getattr(result,'no_visible_metal',False):return '金属：用户标记本图未见可见金属；不能排除隐藏金属构造。'
    visible=ai.get('visible_metal') or {};choice=visible.get('choice') if isinstance(visible,dict) else visible
    if ai.get('status')=='error':return '金属：AI复核请求失败，未能判明；保留已有候选与未知区域。'
    if choice in {'visible','present'}:return '金属：AI判断图中可见金属，但没有可用金属分割区域；不据此伪造掩膜或面积。'
    if choice in {'not_visible','absent'}:return '金属：AI未见明确可见金属；这不等于家具内部没有金属。'
    if ai:return '金属：AI未能判明的区域保持未知，不计为已确认金属。'
    return '金属：尚无明确复核结论；未检出不等于不存在。'


def export_report(result:Result,path,*,composition_output=None):
    from composition_report import _clean,_csv_text
    path=Path(path);data=_clean(result.payload());s=data['statistics'];j=data['judgment']
    ai=_clean(getattr(result,'ai_review',{}) or {});auto=_clean(getattr(result,'auto_status',{}) or {})
    data['ai_review']=ai;data['auto_status']=auto
    j['metal']=_metal_text(result,ai)
    data['interpretation']['metal']='AI未能判明的区域保持未知；AI与人工复核来源分别记录，未检出不等于没有金属。'
    data['interpretation']['areas']='互斥分配的分析图像素；已复核金属覆盖冲突的模型区域，复核来源见parts与ai_review。'
    data['interpretation']['label_png']['5']='已复核金属（来源见记录）'
    part_lookup={p.id:p for p in result.parts}
    for item in data['parts']:
        part=part_lookup.get(item['id'])
        if part:item.update(review_origin=_review_origin(part),review_description=_review_label(part))
    accepted=[p for p in result.parts if p.label=='metal' and p.review in {'accepted','model_accepted'}]
    origins={_review_origin(p) for p in accepted}
    for item in s['materials']:
        if item['material']=='metal':
            item['source']='AI模型复核＋人工复核' if len(origins)>1 else ('AI模型复核' if origins=={'model_review'} else ('人工复核' if origins=={'human_review'} else '未形成已复核金属区域'))
            item['review_origins']=sorted(origins)
        elif item['material']=='unknown' and ai:item['source']='AI未能判明 / 分割未识别'
    picture=png_bytes(render_overlay(result,show_pending=True));original=png_bytes(result.crop)
    data['export_note']='黄色纹理为尚未判明的金属候选，不计入金属面积。模型接受与人工确认分别记录来源。'
    composition_files={};composition_notice='';primary_html='';processing_note='本页表面分割在本机完成。'
    if ai:processing_note+=' AI图片复核的模型、来源与失败记录见result.json。'
    composition_output=composition_output if composition_output is not None else getattr(result,'composition',None)
    if composition_output is not None:
        from composition_report import extra_files,is_fresh,stale_note,primary_summary_html
        if is_fresh(result,composition_output):
            composition_files=extra_files(result,composition_output)
            data['composition_export']={'included':True,'files':list(composition_files),'note':'组成比例为物理输入与构造假设下的条件估计，详情见主要材料报告。'}
            composition_notice='本分析包附主要材料报告.html与composition.json；质量/材料体积比例及其条件敏感性区间见该报告。'
            primary_html=primary_summary_html(result,composition_output)
            processing_note='本页表面分割在本机完成；主要材料分析使用的图片决策服务与模型版本见主要材料报告。'
        else:
            reason=stale_note(composition_output)
            data.pop('composition',None)
            data['composition_export']={'included':False,'reason':'stale','note':reason}
            data['export_note']+=' '+reason
            composition_notice=reason
    summary=StringIO(newline='');writer=csv.writer(summary)
    writer.writerow(['材质','分析图像素','选定区域可见面积占比','最高模型分数','依据'])
    for r in s['materials']:
        writer.writerow([_csv_text(r['name']),r['pixels'],f"{r['ratio']:.6f}",'' if r['highest_model_score'] is None else f"{r['highest_model_score']:.6f}",_csv_text(r['source'])])
    e=html.escape
    bars=''.join(f'''<tr><td><i style="background:{COLORS[r['material']]}"></i>{e(r['name'])}</td><td>{r['ratio']:.1%}</td><td>{r['pixels']:,}</td><td>{e(r['source'])}</td></tr>''' for r in s['materials'])
    part_rows=''.join(f"<tr><td>{e(p.id)}</td><td>{e(CN[p.label])}</td><td>{('人工标注' if p.source=='manual' else '未记录分割分数') if p.score is None else f'{p.score:.2f}'}</td><td>{e(_review_label(p))}</td></tr>" for p in result.parts)
    ai_text='AI未能判明的项目直接保持未知；unknown不等于没有该材料。'
    if ai.get('status')=='error':ai_text='AI自动复核失败，未将失败或未知当成已确认材质。原因：'+str(ai.get('error') or '见自动流程记录。')
    ai_details='<details><summary>AI自动复核与流程来源记录</summary><pre>'+e(json.dumps({'ai_review':ai,'auto_status':auto},ensure_ascii=False,indent=2))+'</pre></details>'
    page=f'''<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>{e(result.name)} · 材质分析报告</title>
<style>body{{margin:0;background:#f3f5f8;color:#223044;font:15px/1.7 'Microsoft YaHei',sans-serif}}main{{max-width:1060px;margin:36px auto;padding:32px;background:white;border-radius:18px}}h1{{font-size:28px;margin:0}}small{{color:#6d7b8e}}.pill{{display:inline-block;background:#e7f4ef;color:#14654d;border-radius:20px;padding:3px 12px;margin-bottom:14px}}.note{{background:#fff6e5;border-left:4px solid #e9af39;padding:14px;border-radius:8px}}.grid{{display:grid;grid-template-columns:1.1fr 1fr;gap:24px;margin-top:22px}}img{{width:100%;border-radius:10px;background:#e9edf3}}table{{width:100%;border-collapse:collapse;font-size:14px}}td,th{{border-bottom:1px solid #e6eaf0;text-align:left;padding:10px 6px}}i{{display:inline-block;width:10px;height:10px;margin-right:7px;border-radius:3px}}footer{{border-top:1px solid #e6eaf0;padding-top:20px;margin-top:28px;color:#66768c;font-size:13px}}@media print{{body{{background:white}}main{{margin:0;padding:12px}}}}@media(max-width:700px){{main{{margin:8px;padding:18px}}.grid{{grid-template-columns:1fr}}}}</style>
<main><span class="pill">单件家具 · 主要材料与比例、可见证据</span><h1>{e(result.name)}</h1><small>{e(result.document.path.name)}　{e(result.created_at)}</small>
{primary_html}<h2>可见表面分割证据</h2><h3>{e(j['title'])}</h3><p>{e(j['body'])}</p><p class="note"><b>{e(j['metal'])}</b><br>黄色纹理仅表示尚未判明的金属候选，不计入已复核金属面积。<br>{e(ai_text)}<br>{e(composition_notice)}</p>
<div class="grid"><div><img alt="材质分割证据图" src="data:image/png;base64,{base64.b64encode(picture).decode()}"><p><small>互斥材质分割；已复核金属覆盖冲突区域，AI或人工来源见记录。</small></p></div><section><h3>可见区域分布</h3><table><tr><th>材质</th><th>面积占比</th><th>分析像素</th><th>依据</th></tr>{bars}</table><p><small>{e(j['limitation'])}</small></p></section></div>
<h3>区域与复核记录</h3><table><tr><th>编号</th><th>类别</th><th>模型分数 / 来源</th><th>复核状态</th></tr>{part_rows}</table>
{ai_details}<footer>模型分数不是经校准的正确概率。四类模型没有金属类别；金属掩膜来自辅助分割或已有标注，AI与人工复核来源分别保留。未检出不等于没有金属。图片无法可靠判断内部框架、隐藏紧固件、实木/贴皮、具体塑料或合金牌号。<br>目标方式：{e(result.target.mode)}；分析尺寸：{result.crop.width} × {result.crop.height}；原图选区：{e(str(result.roi_original))}。<br>像素结果 material_labels.png：0=未判断，1=织物，2=木材，3=塑料，4=玻璃，5=已复核金属（来源见记录），255=选区外。坐标、模型和人工决策来源见 result.json。{e(processing_note)}</footer></main></html>'''
    with zipfile.ZipFile(path,'w',zipfile.ZIP_DEFLATED,compresslevel=5) as z:
        z.writestr('分析报告.html',page.encode('utf-8'));z.writestr('result.json',json.dumps(data,ensure_ascii=False,indent=2).encode('utf-8'))
        z.writestr('材质统计.csv',summary.getvalue().encode('utf-8-sig'));z.writestr('材质分割.png',picture);z.writestr('家具局部原图.png',original)
        z.writestr('material_labels.png',png_bytes(Image.fromarray(result.label_map())))
        z.writestr('target_mask.png',png_bytes(Image.fromarray(result.target_mask.astype(np.uint8)*255)))
        for filename,content in composition_files.items():z.writestr(filename,content)
    return path
