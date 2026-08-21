UPDATE public.orders SET status = 'CANCELLED' WHERE id = 'eb9479b3-a7eb-4dbd-9419-e6de1096eb95';
UPDATE public.products p SET reserved_stock = GREATEST(p.reserved_stock - oi.quantity, 0)
FROM public.order_items oi
WHERE oi.order_id = 'eb9479b3-a7eb-4dbd-9419-e6de1096eb95' AND oi.product_id = p.id;