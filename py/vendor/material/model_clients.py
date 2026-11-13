"""Explicit free/paid client selection; no automatic paid fallback."""
from decision_client import DecisionClient,DEFAULT_MODEL
from free_vision_client import FreeVisionClient,DEFAULT_FREE_MODEL

FREE_LABEL='免费视觉模型'
PAID_LABEL='Decider V1.2（付费）'
CLIENT_MODES={FREE_LABEL:'free',PAID_LABEL:'decider'}

def make_client(api_key,*,mode='free',model=None,**kwargs):
    if mode=='free':return FreeVisionClient(api_key,model=model or DEFAULT_FREE_MODEL,**kwargs)
    if mode=='decider':return DecisionClient(api_key,model=model or DEFAULT_MODEL,**kwargs)
    raise ValueError('请选择免费视觉模型，或明确选择付费 Decider。')
