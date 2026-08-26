-- Restructure departments to match the Orbit Commander role hierarchy:
--   CEO, Chief of Development Department, Chief Marketing Operation, HR
-- This migration renames legacy department names and introduces the CEO department.

-- 1. Rename legacy departments to the new role-hierarchy names
UPDATE public.ai_departments
SET name = 'Chief of Development Department'
WHERE name = 'Developer';

UPDATE public.ai_departments
SET name = 'Chief Marketing Operation'
WHERE name = 'Marketer';

-- 2. Insert the CEO department for every organization that does not already have one
INSERT INTO public.ai_departments (organization_id, name, color, icon)
SELECT org.id, 'CEO', '#f59e0b', 'user-round'
FROM public.organizations org
WHERE NOT EXISTS (
  SELECT 1
  FROM public.ai_departments d
  WHERE d.organization_id = org.id
    AND d.name = 'CEO'
);

-- 3. Assign the CEO agent to the CEO department where it is currently unassigned
UPDATE public.ai_agents
SET department_id = dept.id
FROM public.ai_departments dept
WHERE ai_agents.role = 'CEO'
  AND ai_agents.department_id IS NULL
  AND dept.organization_id = ai_agents.organization_id
  AND dept.name = 'CEO';
