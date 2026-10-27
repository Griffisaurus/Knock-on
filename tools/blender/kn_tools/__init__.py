"""kn_tools: KNOCK-ON part authoring add-on (docs/art/ASSET_PIPELINE.md).

Operators are thin wrappers over plain modules (template, ports, validate, export, library) so the exact
same code runs from the UI and headless (`blender -b ... -P tools/blender/export_part.py`).

Install: Edit > Preferences > Add-ons > Install from Disk (zip this folder), or symlink
tools/blender/kn_tools into your Blender add-ons folder. Set KNOCKON_ROOT if the add-on lives outside the repo.
"""

bl_info = {
    'name': 'KNOCK-ON kn_tools',
    'author': 'KNOCK-ON Tech Art',
    'version': (0, 1, 0),
    'blender': (4, 4, 0),
    'location': 'View3D > Sidebar > KNOCK-ON',
    'description': 'Part template, port ring snap, validator and one-click export for KNOCK-ON parts',
    'category': 'Import-Export',
}

import bpy  # noqa: E402
from bpy.props import EnumProperty, FloatProperty, IntProperty, StringProperty  # noqa: E402

from . import conventions  # noqa: E402

_FAMILIES = [(f, f, '') for f in conventions.FAMILIES]
_CLASSES = [(c, c, '') for c in conventions.CLASSES]
_SIZES = [(s, 'PR-' + s, '') for s in conventions.PORT_SIZES]
_CHANNELS = [(c, c, '') for c in conventions.CHANNELS]


def _report_lines(op, text, level='INFO'):
    for line in text.splitlines():
        op.report({level}, line)


class KN_OT_new_part(bpy.types.Operator):
    """Create the KNOCK-ON part template: collections, root empty with kn_* properties, metric units"""
    bl_idname = 'kn.new_part'
    bl_label = 'New Part'
    bl_options = {'REGISTER', 'UNDO'}

    part_type: StringProperty(name='Type id', default='new_part')
    family: EnumProperty(name='Family', items=_FAMILIES, default='frame')
    part_class: EnumProperty(name='Class', items=_CLASSES, default='S')
    footprint: StringProperty(name='Footprint (cells w,h,d)', default='1,1,1')
    mass_hint: FloatProperty(name='Mass hint (kg)', default=1.0, min=0.0)
    tri_budget: IntProperty(name='LOD0 tri budget (brief)', default=0, min=0)

    def invoke(self, context, event):
        return context.window_manager.invoke_props_dialog(self)

    def execute(self, context):
        from . import template
        try:
            template.new_part(self.part_type, self.family, self.part_class, self.footprint, self.mass_hint,
                              tri_budget=self.tri_budget or None)
        except ValueError as e:
            self.report({'ERROR'}, str(e))
            return {'CANCELLED'}
        return {'FINISHED'}


class KN_OT_add_port(bpy.types.Operator):
    """Add a PORT__<channel>__<name> empty at the 3D cursor (+X = outward), then snap it"""
    bl_idname = 'kn.add_port'
    bl_label = 'Add Port'
    bl_options = {'REGISTER', 'UNDO'}

    channel: EnumProperty(name='Channel', items=_CHANNELS, default='power')
    port_name: StringProperty(name='Name', default='in')
    size: EnumProperty(name='Size', items=_SIZES, default='M')
    direction: EnumProperty(name='Dir', items=[(d, d, '') for d in conventions.PORT_DIRS], default='in')

    def invoke(self, context, event):
        return context.window_manager.invoke_props_dialog(self)

    def execute(self, context):
        from . import ports
        try:
            ob = ports.add_port(self.channel, self.port_name, context.scene.cursor.location.copy(), (0, -1, 0),
                                size=self.size, dir=self.direction)
            ports.snap_port_ring(ob)
        except (ValueError, KeyError, RuntimeError) as e:
            self.report({'ERROR'}, str(e))
            return {'CANCELLED'}
        for o in context.selected_objects:
            o.select_set(False)
        ob.select_set(True)
        context.view_layer.objects.active = ob
        return {'FINISHED'}


class KN_OT_snap_port_ring(bpy.types.Operator):
    """Snap the selected PORT empties onto the RENDER surface and instance the linked port ring"""
    bl_idname = 'kn.snap_port_ring'
    bl_label = 'Snap Port Ring'
    bl_options = {'REGISTER', 'UNDO'}

    size: EnumProperty(name='Size', items=[('KEEP', 'Keep', 'Use the port size property')] + _SIZES,
                       default='KEEP')

    def execute(self, context):
        from . import ports
        targets = [o for o in context.selected_objects if conventions.parse_name('PORT', o.name)]
        if not targets:
            self.report({'ERROR'}, 'select one or more PORT__<channel>__<name> empties')
            return {'CANCELLED'}
        for ob in targets:
            try:
                ports.snap_port_ring(ob, size=None if self.size == 'KEEP' else self.size)
            except (ValueError, KeyError, RuntimeError) as e:
                self.report({'ERROR'}, '%s: %s' % (ob.name, e))
                return {'CANCELLED'}
        return {'FINISHED'}


class KN_OT_validate(bpy.types.Operator):
    """Run validator v1 (ASSET_PIPELINE §9) on this part"""
    bl_idname = 'kn.validate'
    bl_label = 'Validate Part'

    def execute(self, context):
        from . import validate
        rep = validate.validate(context.scene)
        print(rep.format())
        _report_lines(self, rep.format(), 'INFO' if rep.ok else 'WARNING')
        return {'FINISHED'} if rep.ok else {'CANCELLED'}


class KN_OT_export(bpy.types.Operator):
    """Validate, then export .glb + .art.json + .shapes.json to assets/build/parts/<type>/"""
    bl_idname = 'kn.export_part'
    bl_label = 'Export Part'

    def execute(self, context):
        from . import export
        try:
            summary = export.export_part(scene=context.scene)
        except export.ExportError as e:
            self.report({'ERROR'}, str(e))
            return {'CANCELLED'}
        self.report({'INFO'}, 'exported %s' % summary['outputs']['glb'])
        return {'FINISHED'}


class KN_OT_build_libs(bpy.types.Operator):
    """Rebuild assets/src/lib/materials.blend and port_ring.blend (discards the open file)"""
    bl_idname = 'kn.build_libs'
    bl_label = 'Rebuild Libraries'

    def execute(self, context):
        from . import library, paths
        built = library.ensure_libs(paths.repo_root(bpy.data.filepath or None), force=True)
        self.report({'INFO'}, 'built %s' % ', '.join(built))
        return {'FINISHED'}


class KN_PT_panel(bpy.types.Panel):
    bl_label = 'KNOCK-ON'
    bl_space_type = 'VIEW_3D'
    bl_region_type = 'UI'
    bl_category = 'KNOCK-ON'

    def draw(self, context):
        col = self.layout.column(align=True)
        col.operator(KN_OT_new_part.bl_idname, icon='ADD')
        col.operator(KN_OT_add_port.bl_idname, icon='EMPTY_SINGLE_ARROW')
        row = col.row(align=True)
        for s in conventions.PORT_SIZES:
            row.operator(KN_OT_snap_port_ring.bl_idname, text='Snap ' + s).size = s
        col.separator()
        col.operator(KN_OT_validate.bl_idname, icon='CHECKMARK')
        col.operator(KN_OT_export.bl_idname, icon='EXPORT')


CLASSES = (KN_OT_new_part, KN_OT_add_port, KN_OT_snap_port_ring, KN_OT_validate, KN_OT_export, KN_OT_build_libs,
           KN_PT_panel)


def register():
    for c in CLASSES:
        bpy.utils.register_class(c)


def unregister():
    for c in reversed(CLASSES):
        bpy.utils.unregister_class(c)
