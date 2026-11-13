"""Local furniture material inference and review. All percentages concern visible pixels."""
from __future__ import annotations
from dataclasses import dataclass, field
from pathlib import Path
from datetime import datetime
from zoneinfo import ZoneInfo
import hashlib
import os
import threading
from typing import Callable
import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageOps

ROOT = Path(__file__).resolve().parent
RUNTIME = Path(os.environ.get('FM_RUNTIME_DIR', ROOT / '.runtime'))
os.environ.setdefault('YOLO_CONFIG_DIR', str(RUNTIME / 'ultralytics'))
os.environ.setdefault('MPLCONFIGDIR', str(RUNTIME / 'matplotlib'))
os.environ['YOLO_OFFLINE'] = 'true'
MATERIALS = ['fabric', 'wood', 'plastic', 'glass', 'metal']
CN = {'fabric':'织物','wood':'木材','plastic':'塑料','glass':'玻璃','metal':'金属','unknown':'未判断 / 背景'}
COLORS = {'fabric':'#7469da','wood':'#c88b44','plastic':'#25a396','glass':'#4e98d3','metal':'#59687a','unknown':'#cbd2dc'}
FURNITURE = {'bench':'长椅','chair':'椅子','couch':'沙发','bed':'床','dining table':'桌子'}

@dataclass
class Document:
    path: Path
    image: Image.Image
    preview: Image.Image
    alpha: Image.Image | None
    sha256: str

    @classmethod
    def open(cls, path):
        path = Path(path)
        with Image.open(path) as im:
            if im.width * im.height > 40_000_000:
                raise ValueError('图片过大，请先缩小到 4000 万像素以内。')
            im = ImageOps.exif_transpose(im)
            if im.mode == 'P' and 'transparency' in im.info: im = im.convert('RGBA')
            alpha = im.getchannel('A').copy() if 'A' in im.getbands() else None
            if alpha is not None:
                rgba = im.convert('RGBA')
                bg = Image.new('RGBA', rgba.size, 'white'); bg.alpha_composite(rgba)
                image = bg.convert('RGB')
                if alpha.getextrema() == (255,255): alpha = None
            else:
                image = im.convert('RGB').copy()
        if min(image.size) < 24:
            raise ValueError('图片尺寸太小，长宽至少需要 24 像素。')
        image.info.clear()
        if alpha is not None: alpha.info.clear()
        preview = image.copy(); preview.thumbnail((1600,1600), Image.Resampling.LANCZOS)
        return cls(path, image, preview, alpha, hashlib.sha256(path.read_bytes()).hexdigest())

    def preview_to_original(self, xy):
        return (xy[0]*self.image.width/self.preview.width, xy[1]*self.image.height/self.preview.height)

@dataclass
class Target:
    bbox: tuple[float,float,float,float] | None = None
    polygon: list[tuple[float,float]] | None = None
    preview_mask: np.ndarray | None = None
    mode: str = 'whole'
    name: str = '家具'

@dataclass
class Part:
    id: str
    label: str
    score: float | None
    mask: np.ndarray
    source: str
    review: str = 'model'

@dataclass
class Result:
    document: Document
    target: Target
    crop: Image.Image
    roi_original: tuple[int,int,int,int]
    target_mask: np.ndarray
    parts: list[Part]
    name: str = '家具'
    no_visible_metal: bool = False
    created_at: str = field(default_factory=lambda:datetime.now(ZoneInfo('Asia/Shanghai')).isoformat(timespec='seconds'))
    settings: dict = field(default_factory=dict)
    ai_review: dict = field(default_factory=dict)
    auto_status: dict = field(default_factory=dict)

    def part(self, part_id):
        return next(p for p in self.parts if p.id == part_id)

    def review_part(self, part_id, decision):
        p = self.part(part_id)
        if decision not in {'accepted','rejected','model','pending'}: raise ValueError('无效的复核状态')
        if p.label != 'metal' and decision in {'accepted','pending'}: raise ValueError('此操作只适用于金属候选')
        p.review = decision
        if p.label == 'metal' and decision in {'accepted','pending'}: self.no_visible_metal = False
        review=getattr(self,'ai_review',None)
        if isinstance(review,dict) and review:review['manual_override']=True

    def review_part_by_model(self,part_id,decision):
        """Record model provenance without ever manufacturing a human action."""
        if decision not in {'accept','reject','unknown'}:raise ValueError('无效的模型复核状态')
        p=self.part(part_id)
        if p.source=='manual' or p.review in {'accepted','rejected'}:raise ValueError('模型不能覆盖已有人工修正。')
        p.review={'accept':'model_accepted','reject':'model_rejected','unknown':'model_uncertain'}[decision]
        if p.label=='metal' and decision=='accept':self.no_visible_metal=False

    def add_metal_polygon(self, points):
        if len(points) < 3: raise ValueError('至少需要三个点。')
        mask = Image.new('L', self.crop.size, 0)
        ImageDraw.Draw(mask).polygon(points, fill=255)
        mask = (np.asarray(mask)>0) & self.target_mask
        if int(mask.sum()) < 3: raise ValueError('标注没有覆盖有效的家具区域。')
        manual_id = 'U'+str(1+max([int(p.id[1:]) for p in self.parts if p.source=='manual'] or [0]))
        self.parts.append(Part(manual_id,'metal',None,mask,'manual','accepted'))
        self.no_visible_metal = False
        return manual_id

    def confirm_no_metal(self):
        for p in self.parts:
            if p.label == 'metal': p.review = 'rejected'
        self.no_visible_metal = True

    def reset_review(self):
        self.parts = [p for p in self.parts if p.source != 'manual']
        for p in self.parts: p.review = 'pending' if p.label == 'metal' else 'model'
        self.no_visible_metal = False
        self.ai_review={}
        self.auto_status={}
        output=getattr(self,'composition',None)
        if isinstance(output,dict):output['stale']=True;output['stale_reason']='已撤销复核，请重新自动分析。'

    def label_map(self):
        labels = np.zeros(self.target_mask.shape, np.uint8)
        scores = np.full(self.target_mask.shape, -1., np.float32)
        for p in self.parts:
            if p.label == 'metal' or p.review in {'rejected','model_rejected'}: continue
            winner = p.mask & self.target_mask & (float(p.score or 0)>scores)
            labels[winner] = MATERIALS.index(p.label)+1
            scores[winner] = float(p.score or 0)
        for p in self.parts:
            if p.label == 'metal' and p.review in {'accepted','model_accepted'}: labels[p.mask & self.target_mask] = 5
        labels[~self.target_mask] = 255
        return labels

    def statistics(self):
        labels = self.label_map(); total = int(self.target_mask.sum())
        stats = []
        for index,key in enumerate(MATERIALS+['unknown']):
            value = index+1 if key != 'unknown' else 0
            pixels = int((labels==value).sum())
            if key == 'unknown' or pixels:
                relevant=[p for p in self.parts if p.label==key and p.review not in {'rejected','model_rejected'} and (key!='metal' or p.review in {'accepted','model_accepted'})]
                scores=[p.score for p in relevant if p.score is not None]
                if key=='unknown':source='未判断'
                elif key=='metal':
                    human=any(p.review=='accepted' for p in relevant);model=any(p.review=='model_accepted' for p in relevant)
                    source='人工与模型复核' if human and model else ('人工复核' if human else '模型复核')
                else:source='模型复核' if any(p.review=='model_accepted' for p in relevant) else '模型估计'
                stats.append({'material':key,'name':CN[key],'pixels':pixels,'ratio':pixels/total if total else 0,'highest_model_score':max(scores) if scores else None,'source':source})
        pending=[p for p in self.parts if p.label=='metal' and p.review=='pending']
        accepted=[p for p in self.parts if p.label=='metal' and p.review=='accepted']
        model_accepted=[p for p in self.parts if p.label=='metal' and p.review=='model_accepted']
        uncertain=[p for p in self.parts if p.label=='metal' and p.review=='model_uncertain']
        review=getattr(self,'ai_review',{}) or {};visible=review.get('visible_metal',{}).get('choice','unknown')
        if accepted:metal_state='confirmed_present'
        elif self.no_visible_metal:metal_state='user_no_visible_metal'
        elif model_accepted:metal_state='model_confirmed_present'
        elif review.get('status')=='error':metal_state='ai_review_failed'
        elif review.get('status')=='complete':
            metal_state='model_visible_unsegmented' if visible=='visible' else ('model_unresolved' if uncertain or visible=='unknown' else 'model_not_visible')
        else:metal_state='pending_candidates' if pending else ('not_checked' if self.settings.get('metal_auxiliary_enabled',True) is False else 'not_detected_unresolved')
        return {'target_pixels':total,'materials':stats,'known_ratio':1-next(v['ratio'] for v in stats if v['material']=='unknown'),'metal_state':metal_state,'pending_metal_count':len(pending),'model_accepted_metal_count':len(model_accepted),'model_uncertain_metal_count':len(uncertain),'ai_review_status':review.get('status','not_run')}

    def judgment(self):
        s = self.statistics()
        active = sorted([m for m in s['materials'] if m['material']!='unknown' and m['pixels']>0],key=lambda x:x['pixels'],reverse=True)
        if not active or s['known_ratio'] < .15:
            title='依据不足，暂不能判断主要材质'
            body='请框选家具、补充清晰近照，或调整分割阈值后重试。'
        else:
            dominant=active[0]
            meaningful=[m for m in active if m['ratio']>=max(.01,s['known_ratio']*.05)]
            if len(meaningful)>1:
                title='可见混合材质：'+'、'.join(m['name'] for m in meaningful)
            else: title='可见表面以'+dominant['name']+'为主'
            body=f"已判断选定区域的 {s['known_ratio']:.1%}；其余区域可能含背景或未识别材质。"
        metal={'confirmed_present':'金属：已人工确认存在可见金属区域。','user_no_visible_metal':'金属：用户确认本图未见可见金属。','pending_candidates':f"金属：发现 {s['pending_metal_count']} 处辅助候选，尚未完成模型复核。",'not_checked':'金属：辅助检查未开启，尚未判断。','not_detected_unresolved':'金属：本机模型未检出；不能据此判断没有可见或内部金属。','model_confirmed_present':'金属：视觉模型复核支持存在可见金属区域，仍属于模型判断。','model_visible_unsegmented':'金属：视觉模型判断存在可见金属，但尚无可用分割区域，不虚构面积。','model_not_visible':'金属：视觉模型本图未见可见金属；不能排除内部或隐藏金属。','model_unresolved':'金属：视觉模型复核仍不确定，保留未知；不要求人工确认才能继续。','ai_review_failed':'金属：自动视觉复核失败，保留本机分割；尚无自动金属结论。'}[s['metal_state']]
        return {'title':title,'body':body,'metal':metal,'limitation':'占比仅为选定可见区域的分析像素估算，不代表内部结构、质量或体积组成。'}

    def payload(self):
        h,w = self.target_mask.shape; x0,y0,x1,y1 = self.roi_original
        def contours(mask):
            cs,hierarchy=cv2.findContours(mask.astype(np.uint8),cv2.RETR_CCOMP,cv2.CHAIN_APPROX_SIMPLE)
            out=[]
            if hierarchy is None:return out
            for i,c in enumerate(cs):
                p=cv2.approxPolyDP(c,1.,True).reshape(-1,2)
                if len(p)<3:continue
                out.append({'hole':bool(hierarchy[0][i][3]>=0),'analysis_xy':p.tolist(),'original_xy':[[round(x0+float(x)*(x1-x0)/w,2),round(y0+float(y)*(y1-y0)/h,2)] for x,y in p]})
            return out
        return {'schema_version':1,'name':self.name,'created_at':self.created_at,'image':{'filename':self.document.path.name,'sha256':self.document.sha256,'original_size':list(self.document.image.size),'exif_orientation_normalized':True},'analysis':{'size':[w,h],'roi_original_xyxy':list(self.roi_original),'target_mode':self.target.mode,'target_polygon_original':self.target.polygon,'settings':self.settings},'judgment':self.judgment(),'statistics':self.statistics(),'parts':[{'id':p.id,'material':p.label,'name':CN[p.label],'model_score':p.score,'source':p.source,'review':p.review,'pixels':int(p.mask.sum()),'contours':contours(p.mask)} for p in self.parts],'ai_review':getattr(self,'ai_review',{}) or {},'auto_status':getattr(self,'auto_status',{}) or {},'models':{'primary':'YOLO26x-seg, trained for fabric/wood/plastic/glass','metal_auxiliary':'YOLO26n-seg, previous five-class model; metal mask AP50-95 on prior test: 3.08%; candidate use only','furniture_locator':'COCO-pretrained YOLO26n-seg; optional target outline, not material inference'},'interpretation':{'model_scores':'模型输出分数，不是经校准的材质正确概率。','metal':'未知区域不自动归为金属；未检出金属不等于没有金属。','areas':'互斥分配的分析图像素；人工或模型复核通过的金属覆盖冲突材质；模型复核不冒充人工。','coordinates':'原图坐标为按 EXIF 方向纠正后的坐标；analysis 坐标位于家具局部图。','label_png':{'0':'unknown','1':'fabric','2':'wood','3':'plastic','4':'glass','5':'reviewed metal','255':'outside target'}}}


def prepare_crop(document:Document,target:Target,max_side=1600):
    ow,oh=document.image.size
    bounds=target.bbox or (0,0,ow,oh)
    x0,y0,x1,y1=(max(0,int(np.floor(bounds[0]))),max(0,int(np.floor(bounds[1]))),min(ow,int(np.ceil(bounds[2]))),min(oh,int(np.ceil(bounds[3]))))
    if x1-x0<8 or y1-y0<8:raise ValueError('家具区域太小，请重新框选。')
    crop=document.image.crop((x0,y0,x1,y1)); crop.thumbnail((max_side,max_side),Image.Resampling.LANCZOS)
    w,h=crop.size
    target_mask=np.ones((h,w),bool)
    if target.polygon:
        canvas=Image.new('L',(w,h),0)
        ImageDraw.Draw(canvas).polygon([((x-x0)*w/(x1-x0),(y-y0)*h/(y1-y0)) for x,y in target.polygon],fill=255)
        target_mask=np.asarray(canvas)>0
    elif target.preview_mask is not None:
        pm=Image.fromarray(target.preview_mask.astype(np.uint8)*255)
        pw,ph=pm.size
        mat=(pw/ow*(x1-x0)/w,0,pw/ow*x0,0,ph/oh*(y1-y0)/h,ph/oh*y0)
        target_mask=np.asarray(pm.transform((w,h),Image.Transform.AFFINE,mat,Image.Resampling.NEAREST))>0
    if document.alpha is not None:
        target_mask &= np.asarray(document.alpha.crop((x0,y0,x1,y1)).resize((w,h),Image.Resampling.NEAREST))>16
    if int(target_mask.sum())<8:raise ValueError('目标轮廓没有覆盖有效的家具区域，请重新选择。')
    return crop,(x0,y0,x1,y1),target_mask


class Engine:
    def __init__(self,device=None):self.models={};self.lock=threading.Lock();self.device=device
    def _model(self,role):
        if role not in self.models:
            import torch
            from ultralytics import YOLO, settings
            settings.update({'sync': False})
            if self.device is None:self.device=0 if torch.cuda.is_available() else 'cpu'
            filename={'primary':'material-four.pt','metal':'metal-five.pt','locator':'furniture-coco.pt'}[role]
            path=ROOT/'models'/filename
            if not path.is_file():raise FileNotFoundError(f'缺少模型文件：{path.name}。请使用完整工具包。')
            self.models[role]=YOLO(str(path))
            names=list(self.models[role].names.values())
            if role=='primary' and names!=MATERIALS[:4]:raise ValueError('主模型的四类标签与工具不一致。')
            if role=='metal' and names!=MATERIALS:raise ValueError('金属辅助模型标签不一致。')
        return self.models[role]

    def analyze(self,document,target,material_conf=.25,metal_conf=.20,include_metal=True,progress:Callable[[str],None]=lambda s:None):
        with self.lock:
            crop,roi,mask=prepare_crop(document,target)
            progress('正在识别可见材质…')
            model=self._model('primary')
            result=model.predict(source=crop,conf=material_conf,imgsz=640,device=self.device,retina_masks=True,max_det=100,verbose=False)[0]
            parts=self._parts(result,mask,'four_material','P',minimum=max(12,int(mask.sum()*.0001)))
            del result
            if include_metal:
                progress('正在查找金属候选…')
                model=self._model('metal')
                result=model.predict(source=crop,conf=metal_conf,classes=[4],imgsz=640,device=self.device,retina_masks=True,max_det=100,verbose=False)[0]
                parts+=self._parts(result,mask,'metal_auxiliary','M',minimum=max(6,int(mask.sum()*.00002)))
                del result
            return Result(document,target,crop,roi,mask,parts,name=target.name or '家具',settings={'material_threshold':material_conf,'metal_threshold':metal_conf,'metal_auxiliary_enabled':include_metal,'device':str(self.device),'analysis_max_side':1600})

    def _parts(self,result,target,source,prefix,minimum):
        if result.masks is None:return []
        masks=result.masks.data.detach().cpu().numpy()
        ids=result.boxes.cls.detach().cpu().numpy().astype(int)
        conf=result.boxes.conf.detach().cpu().numpy()
        out=[]; h,w=target.shape
        for raw,label,score in zip(masks,ids,conf):
            m=raw>.5
            if m.shape!=(h,w):m=cv2.resize(m.astype(np.uint8),(w,h),interpolation=cv2.INTER_NEAREST)>0
            m &= target
            if int(m.sum())<minimum:continue
            name=result.names[int(label)]
            if source=='metal_auxiliary' and name!='metal':continue
            out.append(Part(prefix+str(len(out)+1),name,float(score),m,source,'pending' if source=='metal_auxiliary' else 'model'))
        return out

    def locate(self,document):
        with self.lock:
            model=self._model('locator')
            ids=[i for i,n in model.names.items() if n in FURNITURE]
            prediction=model.predict(source=document.preview,classes=ids,conf=.25,imgsz=640,device=self.device,retina_masks=True,max_det=20,verbose=False)[0]
            candidates=[]
            if prediction.masks is None:return candidates
            for i,(raw,box) in enumerate(zip(prediction.masks.data.detach().cpu().numpy(),prediction.boxes)):
                mask=raw>.5
                if mask.shape!=(document.preview.height,document.preview.width):mask=cv2.resize(mask.astype(np.uint8),document.preview.size,interpolation=cv2.INTER_NEAREST)>0
                ys,xs=np.where(mask)
                if len(xs)<50:continue
                score=float(box.conf[0]); name=FURNITURE[prediction.names[int(box.cls[0])]]
                pad=4
                p0=(max(0,int(xs.min())-pad),max(0,int(ys.min())-pad));p1=(min(document.preview.width,int(xs.max())+pad+1),min(document.preview.height,int(ys.max())+pad+1))
                a=document.preview_to_original(p0);b=document.preview_to_original(p1)
                candidates.append({'name':name,'score':score,'area':int(mask.sum()),'target':Target((*a,*b),preview_mask=mask,mode='automatic_outline',name=name)})
            return sorted(candidates,key=lambda c:c['area'],reverse=True)


def render_overlay(result:Result,opacity=.43,show_materials=True,show_pending=True,highlight=None):
    rgb=np.asarray(result.crop).copy();labels=result.label_map();h,w=labels.shape
    if show_materials:
        outside=~result.target_mask
        rgb[outside]=np.rint(rgb[outside]*.35+np.array([240,243,247])*.65).astype(np.uint8)
        for i,name in enumerate(MATERIALS,1):
            color=np.array(tuple(int(COLORS[name][j:j+2],16) for j in (1,3,5)))
            where=labels==i
            rgb[where]=np.rint(rgb[where]*(1-opacity)+color*opacity).astype(np.uint8)
    if show_pending:
        for p in result.parts:
            if p.label=='metal' and p.review in {'pending','model_uncertain'}:
                yy,xx=np.indices((h,w));stripe=p.mask & (((xx+yy)//5)%2==0)
                rgb[stripe]=np.rint(rgb[stripe]*.4+np.array([247,181,53])*.6).astype(np.uint8)
                cs,_=cv2.findContours(p.mask.astype(np.uint8),cv2.RETR_EXTERNAL,cv2.CHAIN_APPROX_SIMPLE)
                cv2.drawContours(rgb,cs,-1,(234,151,24),max(1,round(max(w,h)/700)))
    if highlight:
        p=next((p for p in result.parts if p.id==highlight),None)
        if p is not None:
            cs,_=cv2.findContours(p.mask.astype(np.uint8),cv2.RETR_EXTERNAL,cv2.CHAIN_APPROX_SIMPLE)
            cv2.drawContours(rgb,cs,-1,(255,255,255),max(2,round(max(w,h)/350)))
            cv2.drawContours(rgb,cs,-1,(20,34,52),1)
    return Image.fromarray(rgb)
