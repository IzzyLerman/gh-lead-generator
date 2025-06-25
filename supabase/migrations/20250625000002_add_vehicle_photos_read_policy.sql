-- Add authenticated read access to vehicle-photos table
CREATE POLICY "allow_authenticated_read_vehicle_photos"
ON public."vehicle-photos"
FOR SELECT
TO authenticated
USING (true);