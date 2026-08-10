-- Harden the existing trigger function against caller-controlled search paths.
-- The function remains SECURITY INVOKER and preserves the AF-YYYY-NNNN format.
CREATE OR REPLACE FUNCTION public.generate_job_number()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  NEW.job_number := 'AF-' || EXTRACT(YEAR FROM NOW())::TEXT || '-' || LPAD(nextval('public.job_number_seq'::regclass)::TEXT, 4, '0');
  RETURN NEW;
END;
$$;
