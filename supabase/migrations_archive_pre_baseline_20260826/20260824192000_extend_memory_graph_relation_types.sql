alter table public.graph_relations
  drop constraint if exists graph_relations_relation_type_check;

alter table public.graph_relations
  add constraint graph_relations_relation_type_check check (
    relation_type = any (array[
      'belongs_to', 'contains', 'assigned_to', 'created_by', 'created_from',
      'generated_from_prompt', 'uses', 'used_in', 'adapted_for', 'related_to',
      'depends_on', 'blocks', 'requires_approval', 'approved_by',
      'communicates_with', 'for_client', 'for_task'
    ]::text[])
  );
