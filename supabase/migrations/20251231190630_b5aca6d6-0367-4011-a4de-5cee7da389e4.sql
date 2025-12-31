-- Add DELETE policy for trades table to allow users to delete trades from their own portfolios
CREATE POLICY "Users can delete trades from their portfolios" 
ON public.trades 
FOR DELETE 
USING (portfolio_id IN (
  SELECT portfolios.id
  FROM portfolios
  WHERE portfolios.user_id = auth.uid()
));