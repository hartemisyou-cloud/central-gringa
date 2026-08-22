update public.meta_tracking_settings m
set access_token_ciphertext = 'v1./GBNsR2oT3KmcScj.D2a79BmKHy70AVlUr8QFb2U6OM7nd9XqyhKeY+DdHF98U6CxJeURZDGR769y26BC/eK1BGcaM5RfnPrlshmIVLwaiA7k1aAlQpldzULIK9v6Uk1LclQcO8+SG6DOTr+9TQcN6UFxrMs9WArjNZAVT1bPrl8VxGpydYkIL2+/XS5GZlx7q2AwGXrLDMaTMGAf6ciDXNv2GcTEY9HHcJJy/ASSSIxnv7F4wpddbTlwHssi9n/qh2QTGnpxFzv5zoSde9tDyeKTUEtxMv4oKGgmZv8m2/HmFzQGc5Y=',
    access_token_last4 = 'ZDZD',
    last_error = null,
    last_error_at = null,
    updated_at = now()
from public.stores s
where s.id = m.store_id and s.slug = 'livraria-crista';