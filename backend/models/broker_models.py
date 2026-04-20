# backend/models/broker_account.py
from __future__ import annotations
from decimal import Decimal
from pydantic import BaseModel

class BrokerAccountModel(BaseModel):
    venue:        str
    login_id:     str
    server:       str
    equity:       float
    balance:      float
    margin:       float
    free_margin:  float
    margin_level: float
    currency:     str
    leverage:     int
    timestamp:    int


# backend/models/broker_symbol.py
class BrokerSymbolModel(BaseModel):
    venue:           str
    broker_symbol:   str
    internal_symbol: str
    base_asset:      str
    quote_asset:     str
    trade_mode:      int
    visible:         bool
    contract_size:   float
    volume_min:      float
    volume_step:     float
    point:           float
    digits:          int


# backend/models/broker_position.py
from typing import Optional
class BrokerPositionModel(BaseModel):
    venue:           str
    position_id:     str
    symbol:          str
    broker_symbol:   str
    side:            str
    volume:          float
    entry_price:     float
    current_price:   float
    sl:              Optional[float]
    tp:              Optional[float]
    unrealized_pnl:  float
    swap:            float
    comment:         str
    magic_number:    int
    opened_at:       int
    updated_at:      int


# backend/models/broker_order.py
class BrokerOrderModel(BaseModel):
    venue:             str
    client_order_id:   str
    broker_order_id:   str
    symbol:            str
    broker_symbol:     str
    side:              str
    order_type:        str
    volume:            float
    requested_price:   Optional[float]
    fill_price:        Optional[float]
    sl:                Optional[float]
    tp:                Optional[float]
    status:            str
    comment:           str
    magic_number:      int
    reason:            Optional[str]
    created_at:        int
    updated_at:        int


# backend/models/broker_fill.py
class BrokerFillModel(BaseModel):
    venue:           str
    fill_id:         str
    broker_order_id: str
    position_id:     Optional[str]
    symbol:          str
    broker_symbol:   str
    side:            str
    volume:          float
    price:           float
    fee:             float
    realized_pnl:    float
    timestamp:       int


# backend/models/mt5_health.py
class MT5HealthModel(BaseModel):
    venue:                str
    terminal_connected:   bool
    broker_session_ok:    bool
    symbols_loaded:       bool
    order_path_ok:        bool
    latency_ms:           Optional[float]
    last_error:           Optional[str]
    timestamp:            int


# backend/models/mt5_session.py
class MT5SessionModel(BaseModel):
    login_id:               str
    server:                 str
    connected:              bool
    authorized:             bool
    terminal_initialized:   bool
    last_error_code:        Optional[int]
    last_error_message:     Optional[str]
    last_seen_at:           int
