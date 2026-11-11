"""Procedurally builds Blocktopia Next Fable's 3D models with Blender and exports .glb files.

Usage:
    pip install bpy numpy
    python tools/build_models.py public/models

Everything is authored in game space: Y is up and dinosaurs face -Z. Each dinosaur file
contains top-level objects named after the server's part names (Tail_Tip, Head_Armor, ...),
a non-choppable `Body`, and empties (`Pivot_*`, `Stump_*`) that tell the client where to
hinge limbs and where to show the glowing wound once a part is severed.
"""
import math
import os
import sys
import tempfile

import bpy  # must be imported before bmesh/mathutils
import bmesh
import numpy as np
from mathutils import Matrix, Vector, noise

OUT = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else 'public/models')
TMP = tempfile.mkdtemp()
os.makedirs(OUT, exist_ok=True)


def B(p):
    """Game space (Y up, -Z forward) -> Blender space (Z up)."""
    return Vector((p[0], -p[2], p[1]))


# ---------------------------------------------------------------------------------------------
# Scene helpers
# ---------------------------------------------------------------------------------------------
def reset():
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    for m in list(bpy.data.meshes):
        bpy.data.meshes.remove(m)


def obj(name, bm, mat):
    me = bpy.data.meshes.new(name)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(me)
    bm.free()
    me.materials.append(mat)
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    return ob


def join(name, objs, recenter=True):
    """Merge objects into one named object (one glTF primitive per material)."""
    bm = bmesh.new()
    bm.loops.layers.uv.new('UVMap')
    mats = []
    for o in objs:
        remap = []
        for m in o.data.materials:
            if m not in mats:
                mats.append(m)
            remap.append(mats.index(m))
        n0 = len(bm.faces)
        bm.from_mesh(o.data)
        bm.faces.ensure_lookup_table()
        for f in bm.faces[n0:]:
            f.material_index = remap[f.material_index]
        bpy.data.objects.remove(o, do_unlink=True)
    center = Vector((0, 0, 0))
    if recenter:
        co = np.array([v.co[:] for v in bm.verts])
        center = Vector((co.min(0) + co.max(0)) / 2)
        bmesh.ops.translate(bm, vec=-center, verts=bm.verts)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    for m in mats:
        me.materials.append(m)
    ob = bpy.data.objects.new(name, me)
    ob.location = center
    bpy.context.scene.collection.objects.link(ob)
    return ob


def empty(name, p, r=1.0):
    e = bpy.data.objects.new(name, None)
    e.location = B(p)
    e.scale = (r, r, r)
    bpy.context.scene.collection.objects.link(e)
    return e


def export(name):
    path = os.path.join(OUT, name + '.glb')
    kw = dict(filepath=path, export_format='GLB', export_yup=True, export_apply=True)
    try:
        bpy.ops.export_scene.gltf(**kw, export_image_format='JPEG', export_image_quality=85)
    except TypeError:
        bpy.ops.export_scene.gltf(**kw)
    print(f'  wrote {path} ({os.path.getsize(path) / 1024:.0f} KB)')


# ---------------------------------------------------------------------------------------------
# Procedural textures (all tile in both directions)
# ---------------------------------------------------------------------------------------------
def worley(size, cells, seed):
    rng = np.random.default_rng(seed)
    pts = rng.random((cells, cells, 2))
    y, x = np.mgrid[0:size, 0:size]
    fx, fy = x / size * cells, y / size * cells
    ix, iy = fx.astype(int), fy.astype(int)
    d1 = np.full((size, size), 9.0)
    d2 = d1.copy()
    for dy in (-1, 0, 1):
        for dx in (-1, 0, 1):
            cx, cy = ix + dx, iy + dy
            p = pts[cy % cells, cx % cells]
            d = np.hypot(cx + p[..., 0] - fx, cy + p[..., 1] - fy)
            d2 = np.where(d < d1, d1, np.minimum(d2, d))
            d1 = np.minimum(d1, d)
    return d1, d2


def vnoise(size, cx, cy, seed):
    rng = np.random.default_rng(seed)
    g = rng.random((cy, cx))
    y, x = np.mgrid[0:size, 0:size]
    fx, fy = x / size * cx, y / size * cy
    ix, iy = fx.astype(int), fy.astype(int)
    tx, ty = fx - ix, fy - iy
    tx, ty = tx * tx * (3 - 2 * tx), ty * ty * (3 - 2 * ty)
    a, b = g[iy % cy, ix % cx], g[iy % cy, (ix + 1) % cx]
    c, d = g[(iy + 1) % cy, ix % cx], g[(iy + 1) % cy, (ix + 1) % cx]
    return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty


def fbm(size, cx, cy, seed, octaves=4):
    out = sum(vnoise(size, cx * 2 ** o, cy * 2 ** o, seed + o) / 2 ** o for o in range(octaves))
    return (out - out.min()) / (out.max() - out.min())


def image(name, arr, data=False):
    h, w, _ = arr.shape
    img = bpy.data.images.new(name, w, h, alpha=False)
    rgba = np.ones((h, w, 4), np.float32)
    rgba[..., :3] = np.clip(arr, 0, 1)
    img.pixels.foreach_set(rgba.ravel())
    img.filepath_raw = os.path.join(TMP, name + '.png')
    img.file_format = 'PNG'
    img.save()
    if data:
        img.colorspace_settings.name = 'Non-Color'
    return img


def normal_from_height(h, strength):
    dx = np.roll(h, -1, 1) - np.roll(h, 1, 1)
    dy = np.roll(h, -1, 0) - np.roll(h, 1, 0)
    n = np.dstack([-dx * strength, -dy * strength, np.ones_like(h)])
    n /= np.linalg.norm(n, axis=2, keepdims=True)
    return n * 0.5 + 0.5


def smooth(x, a, b):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def rgb(h):
    return np.array([(h >> 16) & 255, (h >> 8) & 255, h & 255]) / 255.0


def skin_textures(name, back, belly, stripe, glow, seed, cells=40, stripes=6, size=1024):
    """Scaly hide. u wraps around the limb (0 = underside), v runs along it."""
    d1, d2 = worley(size, cells, seed)
    edge = np.clip((d2 - d1) * 3.5, 0, 1)
    n = fbm(size, 4, 4, seed + 10)
    y, x = np.mgrid[0:size, 0:size]
    u, v = x / size, y / size
    w = smooth(0.5 + 0.5 * np.cos(2 * np.pi * u) + (n - 0.5) * 0.35, 0.3, 0.75)[..., None]
    col = rgb(back) * (1 - w) + rgb(belly) * w
    st = np.sin(2 * np.pi * (v * stripes + (n - 0.5) * 1.3 + 0.12 * np.cos(4 * np.pi * u)))
    sm = (smooth(st, 0.25, 0.6) * (1 - w[..., 0]))[..., None]
    col = col * (1 - sm * 0.8) + rgb(stripe) * sm * 0.8
    col = col * (0.5 + 0.5 * edge)[..., None] * (0.8 + 0.4 * n)[..., None]
    gm = (smooth(st, 0.93, 0.995) * (1 - w[..., 0]) * edge)[..., None]
    return (image(name + '_base', col),
            image(name + '_nrm', normal_from_height(np.sqrt(edge), 2.2), data=True),
            image(name + '_glow', rgb(glow) * gm))


def bark_textures(name, dark, light, seed, size=512):
    h = fbm(size, 20, 2, seed, 4)
    col = rgb(dark) * (1 - h[..., None]) + rgb(light) * h[..., None]
    return image(name + '_base', col), image(name + '_nrm', normal_from_height(h, 5.0), data=True)


# ---------------------------------------------------------------------------------------------
# Materials
# ---------------------------------------------------------------------------------------------
def _new_mat(name):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = next(n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    return m, bsdf


def mat_tex(name, base, nrm, glow=None, glow_strength=0.0, rough=0.62):
    m, bsdf = _new_mat(name)
    nt = m.node_tree
    t = nt.nodes.new('ShaderNodeTexImage')
    t.image = base
    nt.links.new(t.outputs['Color'], bsdf.inputs['Base Color'])
    n = nt.nodes.new('ShaderNodeTexImage')
    n.image = nrm
    nm = nt.nodes.new('ShaderNodeNormalMap')
    nt.links.new(n.outputs['Color'], nm.inputs['Color'])
    nt.links.new(nm.outputs['Normal'], bsdf.inputs['Normal'])
    if glow is not None:
        e = nt.nodes.new('ShaderNodeTexImage')
        e.image = glow
        nt.links.new(e.outputs['Color'], bsdf.inputs['Emission Color'])
        bsdf.inputs['Emission Strength'].default_value = glow_strength
    bsdf.inputs['Roughness'].default_value = rough
    return m


def mat_flat(name, color, rough=0.6, metal=0.0, glow=None, glow_strength=0.0, double=False):
    m, bsdf = _new_mat(name)
    lin = lambda h: (*(rgb(h) ** 2.2), 1.0)
    bsdf.inputs['Base Color'].default_value = lin(color)
    bsdf.inputs['Roughness'].default_value = rough
    bsdf.inputs['Metallic'].default_value = metal
    if glow is not None:
        bsdf.inputs['Emission Color'].default_value = lin(glow)
        bsdf.inputs['Emission Strength'].default_value = glow_strength
    m.use_backface_culling = not double
    return m


# ---------------------------------------------------------------------------------------------
# Geometry primitives
# ---------------------------------------------------------------------------------------------
def catmull(rows, n):
    r = np.array(rows, float)
    r = np.vstack([r[0], r, r[-1]])
    out = []
    for i in range(1, len(r) - 2):
        p0, p1, p2, p3 = r[i - 1], r[i], r[i + 1], r[i + 2]
        for k in range(n):
            t = k / n
            out.append(0.5 * (2 * p1 + (p2 - p0) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t
                              + (3 * p1 - p0 - 3 * p2 + p3) * t ** 3))
    out.append(r[-2])
    out = np.array(out)
    out[:, 3:] = np.maximum(out[:, 3:], 0.02)
    return out


def loft(rings, mat, segs=20, side=(1, 0, 0), smooth_n=5):
    """Organic tube through rings of (x, y, z, radius_across, radius_vertical)."""
    r = catmull(rings, smooth_n)
    c = r[:, :3]
    n = len(r)
    side = np.array(side, float)
    bm = bmesh.new()
    uvl = bm.loops.layers.uv.new('UVMap')
    verts, vs, dist, sign = [], [], 0.0, None
    vlen = 2 * math.pi * float(np.mean(r[:, 3:]))
    for i in range(n):
        t = c[min(i + 1, n - 1)] - c[max(i - 1, 0)]
        t /= np.linalg.norm(t)
        n2 = np.cross(t, side)
        n2 /= np.linalg.norm(n2)
        s2 = np.cross(n2, t)
        if sign is None:
            sign = -1.0 if n2[1] > 0 else 1.0
        n2 = n2 * sign
        if i:
            dist += float(np.linalg.norm(c[i] - c[i - 1]))
        ring = []
        for j in range(segs):
            a = 2 * math.pi * j / segs
            ring.append(bm.verts.new(B(c[i] + n2 * math.cos(a) * r[i, 4] + s2 * math.sin(a) * r[i, 3])))
        verts.append(ring)
        vs.append(dist / vlen)
    for i in range(n - 1):
        for j in range(segs):
            k = (j + 1) % segs
            f = bm.faces.new((verts[i][j], verts[i][k], verts[i + 1][k], verts[i + 1][j]))
            uv = ((j / segs, vs[i]), ((j + 1) / segs, vs[i]), ((j + 1) / segs, vs[i + 1]), (j / segs, vs[i + 1]))
            for l, q in zip(f.loops, uv):
                l[uvl].uv = q
            f.smooth = True
    for ring, v in ((verts[0], vs[0]), (verts[-1], vs[-1])):
        f = bm.faces.new(ring)
        for j, l in enumerate(f.loops):
            l[uvl].uv = (j / segs, v)
    return obj('loft', bm, mat)


def spike(base, tip, r, mat, segs=6, r2=0.0):
    b, t = B(base), B(tip)
    d = t - b
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=True, segments=segs, radius1=r, radius2=r2, depth=d.length)
    m = Matrix.Translation((b + t) / 2) @ d.to_track_quat('Z', 'Y').to_matrix().to_4x4()
    bmesh.ops.transform(bm, matrix=m, verts=bm.verts)
    if segs > 10:
        for f in bm.faces:
            f.smooth = len(f.verts) == 4
    return obj('spike', bm, mat)


def blob(c, r, mat, sub=2, bump=0.0, freq=1.0, flat=False, seed=0):
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=sub, radius=1.0)
    off = Vector((seed * 7.1, seed * 3.3, seed * 1.7))
    for v in bm.verts:
        n = v.co.normalized()
        d = 1.0 + bump * noise.noise(n * freq + off)
        v.co = Vector((n.x * d * r[0], n.y * d * r[2], n.z * d * r[1])) + B(c)
    for f in bm.faces:
        f.smooth = not flat
    return obj('blob', bm, mat)


def box(c, s, mat, bevel=0.0, rot=(0, 0, 0)):
    """Box of size s centred on c; rot = rotation about the game X, Y, Z axes (radians)."""
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        v.co = Vector((v.co.x * s[0], v.co.y * s[2], v.co.z * s[1]))
    if bevel > 0:
        bmesh.ops.bevel(bm, geom=list(bm.edges), offset=bevel, segments=2, profile=0.5, affect='EDGES')
    if any(rot):
        m = Matrix.Rotation(rot[1], 4, 'Z') @ Matrix.Rotation(-rot[2], 4, 'Y') @ Matrix.Rotation(rot[0], 4, 'X')
        bmesh.ops.transform(bm, matrix=m, verts=bm.verts)
    bmesh.ops.translate(bm, vec=B(c), verts=bm.verts)
    return obj('box', bm, mat)


def plate(base, h, w, t, mat, tilt=0.0):
    """Kite-shaped dorsal plate standing on `base`, thin across X, optionally tilted sideways."""
    outline = [(-w / 2, 0), (-w * 0.62, h * 0.45), (0, h), (w * 0.62, h * 0.45), (w / 2, 0)]
    ct, st = math.cos(tilt), math.sin(tilt)
    bm = bmesh.new()
    sides = []
    for x in (-t / 2, t / 2):
        ring = []
        for dz, dy in outline:
            edge = 0.35 if dy > 0 else 1.0
            px = x * edge
            ring.append(bm.verts.new(B((base[0] + px * ct - dy * st, base[1] + px * st + dy * ct, base[2] + dz))))
        sides.append(ring)
    bm.faces.new(sides[0])
    bm.faces.new(sides[1])
    for j in range(5):
        k = (j + 1) % 5
        bm.faces.new((sides[0][j], sides[0][k], sides[1][k], sides[1][j]))
    return obj('plate', bm, mat)


def frond(base, ang, length, width, rise, drop, mat, n=7):
    ca, sa = math.cos(ang), math.sin(ang)
    perp = np.array([-sa, 0, ca])
    bm = bmesh.new()
    rows = []
    for i in range(n + 1):
        t = i / n
        c = np.array(base, float) + np.array([ca * length * t, (rise * t - drop * t * t) * length, sa * length * t])
        w = width * math.sin(math.pi * min(t * 0.9 + 0.08, 1.0)) ** 0.7
        lift = np.array([0, 0.3 * w, 0])
        rows.append([bm.verts.new(B(c - perp * w + lift)), bm.verts.new(B(c)), bm.verts.new(B(c + perp * w + lift))])
    for i in range(n):
        for j in range(2):
            bm.faces.new((rows[i][j], rows[i][j + 1], rows[i + 1][j + 1], rows[i + 1][j]))
    return obj('frond', bm, mat)


def at(rings, z):
    """Interpolate a ring table at depth z -> (centre_y, radius_across, radius_vertical)."""
    r = np.array(sorted(rings, key=lambda q: q[2]), float)
    return tuple(float(np.interp(z, r[:, 2], r[:, k])) for k in (1, 3, 4))


# ---------------------------------------------------------------------------------------------
# Shared materials
# ---------------------------------------------------------------------------------------------
bpy.ops.wm.read_factory_settings(use_empty=True)

BONE = mat_flat('Bone', 0xe8dcc0, rough=0.45)
MOUTH = mat_flat('Mouth', 0x5a1420, rough=0.5)
CORE = mat_flat('BioCore', 0xff9f1c, rough=0.2, glow=0xff6a00, glow_strength=4.0)


def dino_mats(name, back, belly, stripe, glow, armor, eye, seed, stripes=6):
    base, nrm, glow_img = skin_textures(name, back, belly, stripe, glow, seed, stripes=stripes)
    return (mat_tex(name + '_Skin', base, nrm, glow_img, 2.5),
            mat_flat(name + '_Armor', armor, rough=0.3, metal=0.2, glow=armor, glow_strength=1.2),
            mat_flat(name + '_Eye', eye, rough=0.1, glow=eye, glow_strength=5.0))


# ---------------------------------------------------------------------------------------------
# Two-legged predators: Voltaic Bio-Rex and Shadow Raptor
# ---------------------------------------------------------------------------------------------
def theropod(fname, mats, g=1.0, hs=1.0, hw=1.0, arm=1.0, quills=False):
    reset()
    skin, armor, eye = mats
    body_r = [(0, 8.7, 6.8, 1.6 * g, 1.8 * g), (0, 8.5, 4, 2.4 * g, 2.7 * g), (0, 8.5, 1, 2.9 * g, 3.2 * g),
              (0, 8.8, -2, 2.8 * g, 3.1 * g), (0, 9.6, -4.5, 2.2 * g, 2.5 * g), (0, 10.9, -6.0, 1.7 * g, 2.0 * g),
              (0, 12.2, -7.0, 1.45 * g, 1.7 * g), (0, 12.9, -7.8, 1.25 * g, 1.4 * g)]
    body = [loft(body_r, skin, segs=24)]
    for sx in (-1, 1):
        a = arm
        sh = np.array([sx * 2.2 * g, 8.0, -4.4])
        pts = [sh, sh + np.array([sx * 0.5, -1.3, -0.9]) * a, sh + np.array([sx * 0.4, -2.3, -2.0]) * a]
        body.append(loft([(*pts[0], 0.5 * a, 0.6 * a), (*pts[1], 0.38 * a, 0.42 * a), (*pts[2], 0.25 * a, 0.28 * a)],
                         skin, segs=10))
        for dx in (-0.2, 0.2):
            tip = pts[2] + np.array([dx * a, -0.6 * a, -0.5 * a])
            body.append(spike(pts[2], tip, 0.14 * a, BONE))
    join('Body', body)

    # --- Head (the whole head is the choppable "Armored Skull Crest") ---
    hp = np.array([0, 12.9, -7.8])
    H = lambda p: hp + np.array(p, float) * hs
    HR = lambda rows: [(*H(q[:3]), q[3] * hs * hw, q[4] * hs) for q in rows]
    skull = [(0, 0.3, 0.6, 1.5, 1.3), (0, 0.6, -0.8, 1.9, 1.5), (0, 0.5, -2.4, 1.7, 1.25),
             (0, 0.2, -4.2, 1.3, 0.9), (0, 0.0, -5.6, 1.0, 0.65), (0, -0.1, -6.3, 0.6, 0.4)]
    jaw = [(0, -0.9, 0.2, 1.3, 0.6), (0, -1.3, -1.5, 1.5, 0.6), (0, -1.55, -3.5, 1.15, 0.45),
           (0, -1.75, -5.2, 0.8, 0.35), (0, -1.8, -5.9, 0.4, 0.2)]
    head = [loft(HR(skull), skin, segs=20), loft(HR(jaw), skin, segs=16),
            blob(H((0, -0.55, -2.6)), (1.0 * hs * hw, 0.35 * hs, 2.6 * hs), MOUTH)]
    for i, z in enumerate(np.linspace(-1.2, -5.9, 10)):
        cy, rx, ry = at(skull, z)
        jy, jx, jr = at(jaw, max(z + 0.25, -5.8))
        for sx in (-1, 1):
            x = sx * rx * 0.8 * hw
            head.append(spike(H((x, cy - ry * 0.7, z)), H((x, cy - ry * 0.7 - 0.6, z - 0.08)), 0.17 * hs, BONE, segs=5))
            xj = sx * jx * 0.78 * hw
            head.append(spike(H((xj, jy + jr * 0.6, z + 0.25)), H((xj, jy + jr * 0.6 + 0.42, z + 0.25)), 0.13 * hs, BONE, segs=5))
    for sx in (-1, 1):
        head.append(blob(H((sx * 1.5 * hw, 1.0, -1.7)), (0.26 * hs,) * 3, eye))
        head.append(blob(H((sx * 1.45 * hw, 1.45, -1.6)), (0.5 * hs, 0.28 * hs, 0.9 * hs), skin, sub=1))
    if quills:
        for i in range(7):
            x = (i - 3) * 0.3 * hw
            head.append(spike(H((x, 1.8, -1.0)), H((x * 1.8, 3.2 + 0.4 * (3 - abs(i - 3)), 2.6)), 0.13, armor, segs=4))
    else:
        for i, z in enumerate((-0.4, -1.7, -3.0, -4.3)):
            cy, rx, ry = at(skull, z)
            head.append(plate(H((0, cy + ry - 0.15, z)), (1.25 - 0.2 * i) * hs, 1.25 * hs, 0.32 * hs, armor))
        for sx in (-1, 1):
            head.append(spike(H((sx * 1.3, 1.5, -1.0)), H((sx * 2.0, 3.1, 0.5)), 0.42 * hs, armor))
    join('Head_Armor', head)
    empty('Pivot_Head', hp)
    empty('Stump_Head_Armor', hp + np.array([0, -0.2, 0.3]), 1.35 * g)

    # --- Tail ---
    upper_r = [(0, 8.7, 5.8, 1.9 * g, 2.1 * g), (0, 8.9, 8.5, 1.55 * g, 1.65 * g), (0, 9.0, 11, 1.2 * g, 1.25 * g),
               (0, 9.0, 13.2, 0.95 * g, 1.0 * g)]
    tip_r = [(0, 9.0, 12.8, 1.0 * g, 1.05 * g), (0, 8.9, 15.5, 0.7 * g, 0.7 * g), (0, 8.7, 18.5, 0.4 * g, 0.4 * g),
             (0, 8.5, 21, 0.12 * g, 0.12 * g)]
    join('Tail_Upper', [loft(upper_r, skin)])
    tip = [loft(tip_r, skin, segs=14)]
    if quills:
        for i, z in enumerate((17.0, 18.4, 19.8)):
            cy, _, r = at(tip_r, z)
            tip.append(plate((0, cy, z), 1.5 - 0.2 * i, 2.4, 0.08, armor))
            tip.append(plate((0, cy, z), 1.1, 2.2, 0.08, armor, tilt=math.pi))
    else:
        for z in (15.2, 16.9, 18.5):
            cy, _, r = at(tip_r, z)
            for sx in (-1, 1):
                tip.append(spike((sx * r * 0.5, cy + r * 0.5, z), (sx * (r + 1.5), cy + r + 1.3, z + 0.7), 0.3, armor))
    join('Tail_Tip', tip)
    empty('Pivot_Tail', (0, 8.8, 5.8))
    empty('Stump_Tail_Upper', (0, 8.7, 6.7), 1.6 * g)
    empty('Stump_Tail_Tip', (0, 9.0, 13.1), 0.95 * g)

    # --- Legs ---
    for sx, tag in ((-1, 'L'), (1, 'R')):
        hx = sx * 2.6 * g
        kx = hx * 1.08
        rings = [(hx, 9.2, 0.9, 1.1 * g, 1.9 * g), (hx * 1.05, 7.2, 0.3, 1.25 * g, 2.0 * g),
                 (kx, 5.0, -0.9, 1.0 * g, 1.3 * g), (kx, 3.4, 0.3, 0.7 * g, 0.85 * g),
                 (kx, 2.0, 1.3, 0.55 * g, 0.65 * g), (kx, 0.9, 0.7, 0.6 * g, 0.7 * g),
                 (kx, 0.45, -0.6, 0.8 * g, 0.42 * g), (kx, 0.35, -2.0, 0.65 * g, 0.26 * g)]
        leg = [loft(rings, skin, segs=16)]
        for dx in (-0.55, 0, 0.55):
            leg.append(spike((kx + dx * g, 0.42, -1.9), (kx + dx * 1.5 * g, 0.05, -3.3 if dx == 0 else -3.0), 0.3 * g, BONE))
        if quills:
            leg.append(spike((kx - sx * 0.5 * g, 0.9, -1.0), (kx - sx * 0.7 * g, 2.4, -2.3), 0.3 * g, BONE))
        join(f'Leg_{tag}_Tendon', leg)
        empty(f'Pivot_Leg{tag}', (hx, 8.0, 0.6))
        empty(f'Stump_Leg_{tag}_Tendon', (hx * 1.1, 7.6, 0.5), 1.45 * g)

    # --- Dorsal armour ---
    back = []
    if quills:
        for z in np.linspace(-4.0, 5.6, 13):
            cy, _, ry = at(body_r, z)
            back.append(spike((0, cy + ry - 0.2, z), (0, cy + ry + 1.9, z + 1.5), 0.16, armor, segs=4))
    else:
        for i, z in enumerate(np.linspace(-4.2, 5.8, 9)):
            cy, _, ry = at(body_r, z)
            back.append(plate((0, cy + ry - 0.3, z), 1.5 + 1.4 * math.sin(math.pi * (i + 0.5) / 9), 1.45, 0.34, armor))
    join('Back_Plates', back)
    cy, _, ry = at(body_r, 0.5)
    empty('Stump_Back_Plates', (0, cy + ry, 0.5), 0.9 * g)

    # --- Bio-Core: glowing crystal cluster bulging out of the chest ---
    cy, _, ry = at(body_r, -2.4)
    cc = np.array([0, cy - ry + 0.3 * g, -2.4])
    core = [blob(cc, (1.3 * g, 1.2 * g, 1.3 * g), CORE, sub=1, flat=True)]
    for dx, dz in ((-0.9, -0.6), (0.9, -0.5), (0.1, 1.0), (-0.3, -1.1)):
        core.append(spike(cc + np.array([dx * g, -0.5 * g, dz * g]), cc + np.array([dx * 1.6 * g, -2.0 * g, dz * 1.6 * g]), 0.38 * g, CORE, segs=5))
    join('Bio_Core', core)
    empty('Stump_Bio_Core', cc, 1.0 * g)
    export(fname)


# ---------------------------------------------------------------------------------------------
# Obsidian Stego-Titan (four legs; the hind pair are the choppable tendons)
# ---------------------------------------------------------------------------------------------
def stego(fname, mats):
    reset()
    skin, armor, eye = mats
    body_r = [(0, 6.8, 7.0, 1.6, 1.7), (0, 8.2, 4.5, 2.8, 3.0), (0, 9.0, 1.5, 3.6, 3.8), (0, 8.4, -2, 3.5, 3.5),
              (0, 7.2, -5, 2.6, 2.8), (0, 6.0, -7.2, 1.6, 1.7), (0, 5.2, -8.8, 1.1, 1.1)]
    join('Body', [loft(body_r, skin, segs=24)])

    hp = np.array([0, 5.0, -8.8])
    H = lambda p: hp + np.array(p, float)
    skull = [(0, 0.1, 0.5, 1.0, 0.9), (0, 0.1, -1.0, 1.15, 1.0), (0, -0.1, -2.6, 0.8, 0.65), (0, -0.35, -3.7, 0.4, 0.35)]
    head = [loft([(*H(q[:3]), q[3], q[4]) for q in skull], skin, segs=16)]
    for sx in (-1, 1):
        head.append(blob(H((sx * 0.95, 0.45, -1.5)), (0.2,) * 3, eye))
        head.append(spike(H((sx * 0.9, -0.2, -0.6)), H((sx * 2.2, -0.5, 0.2)), 0.32, armor))
        head.append(spike(H((sx * 0.5, 0.8, -0.2)), H((sx * 0.9, 2.0, 0.6)), 0.3, armor))
    for i, z in enumerate((0.1, -1.0, -2.0)):
        head.append(plate(H((0, 0.85 - 0.12 * i, z)), 0.9 - 0.2 * i, 0.9, 0.25, armor))
    head.append(spike(H((0, -0.3, -3.5)), H((0, -0.7, -4.3)), 0.35, BONE, segs=5))
    join('Head_Armor', head)
    empty('Pivot_Head', hp + np.array([0, 0.6, 1.2]))
    empty('Stump_Head_Armor', hp + np.array([0, 0.1, 0.3]), 1.0)

    upper_r = [(0, 6.8, 6.5, 1.8, 1.9), (0, 6.2, 9.5, 1.3, 1.3), (0, 5.8, 12.5, 0.9, 0.9)]
    tip_r = [(0, 5.8, 12.2, 0.9, 0.9), (0, 5.6, 15, 0.6, 0.6), (0, 5.5, 18, 0.3, 0.3), (0, 5.5, 19.5, 0.1, 0.1)]
    upper = [loft(upper_r, skin)]
    for i, z in enumerate((7.6, 9.6, 11.4)):
        cy, _, ry = at(upper_r, z)
        upper.append(plate(((-1) ** i * 0.3, cy + ry - 0.2, z), 2.0 - 0.45 * i, 1.6, 0.3, armor, tilt=(-1) ** i * -0.2))
    join('Tail_Upper', upper)
    tip = [loft(tip_r, skin, segs=14)]
    for z in (15.6, 17.4):
        cy, _, r = at(tip_r, z)
        for sx in (-1, 1):
            tip.append(spike((sx * r * 0.4, cy + r * 0.3, z), (sx * 3.2, cy + 1.9, z + 0.9), 0.36, BONE))
    join('Tail_Tip', tip)
    empty('Pivot_Tail', (0, 6.8, 6.5))
    empty('Stump_Tail_Upper', (0, 6.8, 7.0), 1.5)
    empty('Stump_Tail_Tip', (0, 5.8, 12.4), 0.85)

    for sx, tag in ((-1, 'L'), (1, 'R')):
        hx = sx * 3.0
        rings = [(hx, 8.2, 2.0, 1.4, 1.9), (hx * 1.05, 5.5, 1.6, 1.3, 1.5), (hx * 1.05, 3.0, 2.2, 1.0, 1.1),
                 (hx * 1.05, 1.0, 1.9, 0.95, 1.0), (hx * 1.05, 0.25, 1.5, 1.2, 1.25)]
        leg = [loft(rings, skin, segs=16)]
        for dx in (-0.6, 0, 0.6):
            leg.append(spike((hx * 1.05 + dx, 0.35, 0.6), (hx * 1.05 + dx * 1.2, 0.1, -0.2), 0.34, BONE, segs=5))
        join(f'Leg_{tag}_Tendon', leg)
        empty(f'Pivot_Leg{tag}', (hx, 8.0, 2.0))
        empty(f'Stump_Leg_{tag}_Tendon', (hx * 1.08, 7.4, 2.0), 1.45)

        fx = sx * 2.5
        rings = [(fx, 6.6, -4.8, 1.1, 1.3), (fx * 1.05, 4.0, -4.6, 0.9, 1.0), (fx * 1.05, 1.5, -4.9, 0.8, 0.85),
                 (fx * 1.05, 0.25, -5.2, 1.0, 1.05)]
        fleg = [loft(rings, skin, segs=14)]
        for dx in (-0.5, 0, 0.5):
            fleg.append(spike((fx * 1.05 + dx, 0.3, -6.0), (fx * 1.05 + dx * 1.2, 0.1, -6.7), 0.28, BONE, segs=5))
        join(f'FLeg_{tag}', fleg)
        empty(f'Pivot_FLeg{tag}', (fx, 6.4, -4.8))

    back = []
    for i, z in enumerate(np.linspace(-6.0, 6.0, 10)):
        cy, _, ry = at(body_r, z)
        s = (-1) ** i
        back.append(plate((s * 0.55, cy + ry - 0.35, z), 1.8 + 2.6 * math.sin(math.pi * (i + 0.6) / 10.4), 2.3, 0.4, armor, tilt=-s * 0.22))
    join('Back_Plates', back)
    empty('Stump_Back_Plates', (0, 12.6, 1.0), 1.0)

    cc = np.array([0, 8.4 - 3.5 + 0.35, -2.0])
    core = [blob(cc, (1.35, 1.2, 1.35), CORE, sub=1, flat=True)]
    for dx, dz in ((-0.9, -0.6), (0.9, -0.5), (0.1, 1.0)):
        core.append(spike(cc + np.array([dx, -0.5, dz]), cc + np.array([dx * 1.6, -2.0, dz * 1.6]), 0.38, CORE, segs=5))
    join('Bio_Core', core)
    empty('Stump_Bio_Core', cc, 1.0)
    export(fname)


# ---------------------------------------------------------------------------------------------
# Friendly Canopy Brontosaurus with a cabin on its back (static scenery)
# ---------------------------------------------------------------------------------------------
def bronto(fname):
    reset()
    base, nrm, _ = skin_textures('Bronto', 0x3f6b4c, 0xb9c48a, 0x2a4a36, 0x000000, 31, cells=44, stripes=4)
    skin = mat_tex('Bronto_Skin', base, nrm, rough=0.7)
    wood = mat_flat('Wood', 0x8d5b3c, rough=0.85)
    dark = mat_flat('WoodDark', 0x4a2f1f, rough=0.9)
    roof = mat_flat('Thatch', 0xc9a24a, rough=0.95)
    lamp = mat_flat('Lantern', 0xffc46b, glow=0xff9a2e, glow_strength=6.0)
    eye = mat_flat('Bronto_Eye', 0x1a1208, rough=0.1)
    parts = [loft([(0, 9, 10, 2.0, 2.2), (0, 10.5, 6, 4.2, 4.2), (0, 11, 0, 5.2, 5.0), (0, 10.5, -6, 4.2, 4.2),
                   (0, 11.5, -10, 2.6, 2.8), (0, 15, -13, 1.9, 2.0), (0, 21, -15.5, 1.5, 1.5), (0, 27, -17, 1.25, 1.25),
                   (0, 30.5, -18.3, 1.15, 1.15), (0, 31.2, -19.4, 1.35, 1.15), (0, 31.1, -21.2, 1.2, 0.9),
                   (0, 30.8, -22.7, 0.7, 0.5)], skin, segs=24),
             loft([(0, 9, 9.5, 2.1, 2.2), (0, 7.5, 15, 1.3, 1.3), (0, 5, 21, 0.7, 0.7), (0, 2.6, 27, 0.25, 0.25)], skin)]
    for sx in (-1, 1):
        parts.append(blob((sx * 1.2, 31.6, -20.2), (0.22,) * 3, eye))
        for z in (-5.5, 5.5):
            x = sx * 3.3
            parts.append(loft([(x, 9.5, z, 1.9, 2.1), (x, 5.5, z, 1.6, 1.7), (x, 1.5, z, 1.5, 1.55), (x, 0.2, z - 0.2, 1.8, 1.85)], skin, segs=16))
            for dx in (-0.8, 0, 0.8):
                parts.append(spike((x + dx, 0.4, z - 1.4), (x + dx, 0.1, z - 2.2), 0.4, BONE, segs=5))
    parts += [box((0, 16.1, 0.5), (9.5, 0.5, 12), wood, 0.08), box((0, 18.6, 1.0), (7, 4.5, 8), wood, 0.1),
              box((0, 17.6, -2.95), (1.8, 2.6, 0.2), dark), box((2.2, 19.2, -2.95), (1.4, 1.2, 0.2), lamp),
              box((0, 14.2, -3.5), (10.6, 0.5, 0.7), dark), box((0, 14.2, 4.5), (10.6, 0.5, 0.7), dark)]
    for sx in (-1, 1):
        parts.append(box((sx * 2.1, 21.9, 1.0), (4.8, 0.5, 9.4), roof, rot=(0, 0, -sx * 0.5)))
        for z in (-5.2, -1.4, 2.4, 6.2):
            parts.append(box((sx * 4.5, 17.0, z), (0.3, 1.5, 0.3), dark))
        parts.append(box((sx * 4.5, 17.7, 0.5), (0.25, 0.25, 11.8), dark))
        parts.append(spike((sx * 3.9, 16.6, -5.2), (sx * 3.9, 19.5, -5.2), 0.12, dark, segs=6, r2=0.12))
        parts.append(blob((sx * 3.9, 19.9, -5.2), (0.45,) * 3, lamp, sub=1, flat=True))
    join('Bronto', parts, recenter=False)
    export(fname)


# ---------------------------------------------------------------------------------------------
# All-Terrain Harvester Truck (front faces -Z)
# ---------------------------------------------------------------------------------------------
def truck(fname):
    reset()
    paint = mat_flat('Paint', 0xd97706, rough=0.4, metal=0.25)
    steel = mat_flat('Steel', 0x2b323c, rough=0.55, metal=0.3)
    tire = mat_flat('Tire', 0x121212, rough=0.95)
    glass = mat_flat('Glass', 0x10202c, rough=0.08, metal=0.6)
    lamp = mat_flat('Headlamp', 0xfff3c4, glow=0xffe9a8, glow_strength=6.0)
    tail = mat_flat('Taillamp', 0xb01020, glow=0xff2030, glow_strength=3.0)
    cable = mat_flat('Cable', 0x00f5d4, glow=0x00f5d4, glow_strength=2.0)
    p = [box((0, 1.75, 0), (4.4, 0.8, 9.6), steel, 0.1),
         box((0, 3.5, -2.6), (4.8, 2.7, 3.2), paint, 0.3), box((0, 2.75, -4.9), (4.6, 1.5, 1.7), paint, 0.25),
         box((0, 4.0, -4.22), (4.0, 1.1, 0.12), glass), box((0, 4.0, -0.98), (3.6, 0.9, 0.12), glass),
         box((0, 2.6, -5.78), (3.2, 0.9, 0.14), steel), box((0, 2.35, 2.3), (5.0, 0.3, 5.8), steel),
         box((0, 3.0, 5.15), (5.0, 1.0, 0.16), paint), box((0, 5.75, -0.8), (4.7, 0.25, 0.25), steel),
         box((0, 3.35, -0.55), (5.0, 1.7, 0.16), paint),
         spike((-1.3, 3.2, 4.3), (1.3, 3.2, 4.3), 0.55, steel, segs=16, r2=0.55),
         spike((-0.7, 3.2, 4.3), (0.7, 3.2, 4.3), 0.62, cable, segs=16, r2=0.62),
         box((0, 2.9, 4.3), (3.2, 0.5, 0.5), steel)]
    for sx in (-1, 1):
        p += [box((sx * 2.42, 4.0, -2.6), (0.12, 1.0, 2.2), glass), box((sx * 1.7, 2.95, -5.78), (0.8, 0.5, 0.16), lamp),
              box((sx * 2.45, 3.0, 2.3), (0.16, 1.1, 5.8), paint), box((sx * 2.0, 2.9, 5.24), (0.6, 0.35, 0.1), tail),
              box((sx * 2.25, 4.7, -0.8), (0.25, 2.0, 0.25), steel),
              spike((sx * 2.65, 2.4, -0.75), (sx * 2.65, 6.1, -0.75), 0.17, steel, segs=10, r2=0.17),
              box((sx * 1.9, 1.9, -6.1), (0.2, 1.5, 0.2), steel),
              box((sx * 2.55, 2.7, -4.2), (0.5, 0.2, 2.8), steel), box((sx * 2.55, 2.75, 2.8), (0.5, 0.2, 5.0), steel)]
        for z in (-4.2, 1.6, 4.0):
            p.append(spike((sx * 2.05, 1.25, z), (sx * 3.05, 1.25, z), 1.25, tire, segs=20, r2=1.25))
            for k in range(14):  # chunky off-road tread
                a = k * 2 * math.pi / 14
                p.append(box((sx * 2.55, 1.25 + math.sin(a) * 1.28, z + math.cos(a) * 1.28), (1.0, 0.18, 0.3), tire, rot=(math.pi / 2 - a, 0, 0)))
            for k in range(6):
                a = k * math.pi / 3
                p.append(box((sx * 3.13, 1.25 + math.sin(a) * 0.36, z + math.cos(a) * 0.36), (0.06, 0.1, 0.1), steel))
            p.append(box((sx * 2.55, 2.75, z), (1.1, 0.12, 2.9), steel, 0.04))
            p.append(box((sx * 2.55, 1.9, z + 1.5), (0.9, 1.2, 0.08), tire))
        for z in (0.6, 2.3, 4.0):
            p.append(box((sx * 2.45, 4.2, z), (0.12, 1.4, 0.12), steel))
        p.append(box((sx * 2.45, 4.9, 2.3), (0.12, 0.12, 5.6), steel))
        p.append(box((sx * 2.2, 3.0, -5.82), (0.5, 0.35, 0.12), mat_flat('Indicator', 0xff8a00, glow=0xff8a00, glow_strength=2.0)))
        for z in (-4.2, 1.6, 4.0):
            p.append(spike((sx * 2.9, 1.25, z), (sx * 3.12, 1.25, z), 0.6, paint, segs=10, r2=0.5))
    for y in (1.5, 2.3):
        p.append(spike((-2.3, y, -6.1), (2.3, y, -6.1), 0.14, steel, segs=8, r2=0.14))
    for x in (-1.5, -0.5, 0.5, 1.5):
        p.append(box((x, 5.05, -3.4), (0.6, 0.35, 0.3), lamp))
    hazard = mat_flat('TruckHazard', 0x15191e, rough=0.6)
    for i in range(7):
        p.append(box((-2.1 + i * 0.7, 3.0, 5.25), (0.3, 0.9, 0.06), hazard, rot=(0, 0, 0.6)))
    p += [spike((0, 3.4, -0.3), (0, 3.4, 0.2), 1.15, tire, segs=18, r2=1.15), spike((0, 3.4, 0.2), (0, 3.4, 0.3), 0.5, paint, segs=10, r2=0.45),
          spike((1.9, 4.85, -1.4), (1.9, 8.2, -1.2), 0.035, steel, segs=5, r2=0.02), blob((1.9, 8.2, -1.2), (0.09,) * 3, tail, sub=1),
          box((0, 4.9, -0.9), (5.0, 0.12, 0.12), steel), box((0, 2.2, -5.5), (4.9, 0.5, 0.5), steel, 0.08)]
    join('Truck', p, recenter=False)
    export(fname)


# ---------------------------------------------------------------------------------------------
# Jungle props: three trees, two ferns, a rock. Each stands on the origin.
# ---------------------------------------------------------------------------------------------
def environment(fname):
    reset()
    bark = mat_tex('Bark', *bark_textures('Bark', 0x2a1c12, 0x6b4a30, 5), rough=0.9)
    palm_bark = mat_tex('PalmBark', *bark_textures('PalmBark', 0x3a2c1a, 0x8a744a, 9), rough=0.9)
    leaves = [mat_flat(f'Leaf{i}', c, rough=0.8, double=True) for i, c in enumerate((0x1e4a22, 0x2d6a2e, 0x16381c, 0x4a8a34))]
    glowleaf = mat_flat('BioFern', 0x1f7a6a, rough=0.5, glow=0x00f5d4, glow_strength=0.35, double=True)
    stone = mat_flat('Stone', 0x6a6f68, rough=0.95)
    moss = mat_flat('Moss', 0x3d5a2a, rough=1.0)

    # Tree_A: buttress-rooted jungle giant
    p = [loft([(0, 0, 0, 2.2, 2.2), (0, 1.3, 0, 1.35, 1.35), (0, 6, 0.2, 1.0, 1.0), (0, 12, -0.2, 0.85, 0.85), (0, 17.5, 0, 0.55, 0.55)], bark, segs=14)]
    for i in range(5):
        a = i * 2 * math.pi / 5 + 0.3
        ca, sa = math.cos(a), math.sin(a)
        p.append(loft([(ca * 0.6, 2.8, sa * 0.6, 0.35, 0.9), (ca * 1.9, 1.0, sa * 1.9, 0.3, 0.7), (ca * 3.4, -0.1, sa * 3.4, 0.2, 0.3)], bark, segs=8, side=(-sa, 0, ca)))
    for i in range(5):
        a = i * 2 * math.pi / 5 + 1.0
        ca, sa = math.cos(a), math.sin(a)
        y = 11.5 + i * 0.9
        p.append(loft([(ca * 0.5, y, sa * 0.5, 0.4, 0.4), (ca * 3.0, y + 2.2, sa * 3.0, 0.28, 0.28), (ca * 5.5, y + 3.2, sa * 5.5, 0.12, 0.12)], bark, segs=8, side=(-sa, 0, ca)))
        p.append(blob((ca * 5.4, y + 4.0, sa * 5.4), (4.0, 2.5, 4.0), leaves[i % 3], sub=2, bump=0.35, freq=1.7, flat=True, seed=i))
        p.append(spike((ca * 4.6, y + 2.6, sa * 4.6), (ca * 4.7, y - 3.5 - i, sa * 4.7), 0.06, leaves[2], segs=4, r2=0.04))
    p.append(blob((0, 19.5, 0), (5.8, 3.4, 5.8), leaves[1], sub=2, bump=0.35, freq=1.6, flat=True, seed=9))
    p.append(blob((1.5, 22, -1), (3.6, 2.4, 3.6), leaves[3], sub=2, bump=0.4, freq=1.9, flat=True, seed=12))
    join('Tree_A', p, recenter=False)

    # Tree_B: leaning palm
    p = [loft([(0, 0, 0, 0.95, 0.95), (0.3, 4, 0, 0.7, 0.7), (1.0, 8, 0.2, 0.6, 0.6), (1.5, 11.5, 0.3, 0.5, 0.5)], palm_bark, segs=12)]
    for i in range(11):
        a = i * 2 * math.pi / 11
        p.append(frond((1.5, 11.4, 0.3), a, 6.5, 1.15, 0.45 if i % 2 else 0.15, 0.75, leaves[i % 2 * 3]))
    for i in range(3):
        p.append(blob((1.5 + math.cos(i * 2.1) * 0.45, 10.9, 0.3 + math.sin(i * 2.1) * 0.45), (0.35,) * 3, mat_flat('Coconut', 0x5a3a1e) if i == 0 else p[-1].data.materials[0], sub=1))
    join('Tree_B', p, recenter=False)

    # Tree_C: tall tiered tree-fern
    p = [loft([(0, 0, 0, 0.8, 0.8), (0, 8, 0.2, 0.55, 0.55), (0.2, 16, 0, 0.4, 0.4), (0.2, 21, 0, 0.22, 0.22)], bark, segs=10)]
    for tier, (y, length) in enumerate(((11, 5.5), (15, 4.6), (18.5, 3.6), (21, 2.6))):
        for i in range(7):
            a = i * 2 * math.pi / 7 + tier * 0.45
            p.append(frond((0.2, y, 0), a, length, 0.9, 0.25, 0.55, leaves[(tier + i) % 3]))
    join('Tree_C', p, recenter=False)

    for name, m in (('Fern', None), ('Fern_Glow', glowleaf)):
        p = []
        for i in range(9):
            a = i * 2 * math.pi / 9
            p.append(frond((0, 0.05, 0), a, 2.4, 0.5, 0.9, 0.85, m or leaves[i % 4]))
        for i in range(4):
            p.append(frond((0, 0.05, 0), i * 1.6 + 0.4, 1.9, 0.38, 1.5, 0.6, m or leaves[3]))
        join(name, p, recenter=False)

    p = [blob((0, 0.6, 0), (1.7, 1.1, 1.4), stone, sub=2, bump=0.45, freq=1.4, flat=True, seed=3),
         blob((1.2, 0.3, 0.8), (0.9, 0.6, 0.8), stone, sub=1, bump=0.4, freq=1.6, flat=True, seed=5),
         blob((-0.1, 1.25, 0), (1.3, 0.35, 1.05), moss, sub=2, bump=0.5, freq=1.4, flat=True, seed=3)]
    join('Rock', p, recenter=False)

    p = [frond((0, 0, 0), i * 1.05 + 0.2, 0.8 + 0.12 * (i % 3), 0.07, 1.7, 0.6, leaves[(i % 2) * 2 + 1], n=3) for i in range(6)]
    join('Grass', p, recenter=False)

    p = [blob((math.cos(i * 1.7) * 1.1, 0.9 + 0.25 * (i % 2), math.sin(i * 1.7) * 1.1), (1.2, 0.9, 1.2), leaves[i % 4], sub=1, bump=0.4, freq=2.0, flat=True, seed=20 + i) for i in range(5)]
    p += [frond((0, 0.3, 0), i * 1.26, 2.6, 0.45, 0.9, 0.7, leaves[3]) for i in range(5)]
    join('Bush', p, recenter=False)

    cap = mat_flat('ShelfFungus', 0xd98a2b, rough=0.7)
    p = [loft([(-3.2, 0.7, 0, 0.7, 0.75), (0, 0.75, 0.15, 0.7, 0.7), (3.2, 0.7, -0.1, 0.62, 0.65)], bark, segs=12, side=(0, 0, 1)),
         loft([(1.2, 1.1, 0, 0.25, 0.25), (1.6, 2.2, 0.5, 0.18, 0.18), (1.7, 2.9, 1.0, 0.08, 0.08)], bark, segs=7),
         blob((-1.2, 1.35, 0.1), (1.5, 0.22, 0.6), moss, sub=2, bump=0.5, freq=2.0, flat=True, seed=7),
         blob((1.8, 1.3, -0.1), (0.9, 0.2, 0.5), moss, sub=1, bump=0.5, freq=2.0, flat=True, seed=8)]
    for i, x in enumerate((-2.2, -1.5, 0.4)):
        p.append(blob((x, 0.75 + 0.25 * i, -0.8), (0.42, 0.1, 0.36), cap, sub=1, flat=True))
    join('Log', p, recenter=False)

    stalk = mat_flat('Stalk', 0xd8d2c0, rough=0.8)
    shroom = [mat_flat('ShroomTeal', 0x1fa89a, rough=0.4, glow=0x00f5d4, glow_strength=0.9),
              mat_flat('ShroomViolet', 0x8a4fd0, rough=0.4, glow=0x9b5cff, glow_strength=0.9)]
    p = []
    for i, (x, z, h) in enumerate(((0, 0, 1.3), (0.6, 0.3, 0.8), (-0.5, 0.4, 0.95), (0.2, -0.6, 0.6), (-0.6, -0.4, 0.5))):
        p.append(spike((x, 0, z), (x + 0.05, h, z), 0.12, stalk, segs=6, r2=0.08))
        p.append(blob((x + 0.05, h, z), (0.42 * h, 0.2 * h, 0.42 * h), shroom[i % 2], sub=1, flat=True))
    join('Mushrooms', p, recenter=False)

    # Sun-bleached Titan skeleton half-buried in the jungle floor
    p = [loft([(0, 4.2, -7, 0.45, 0.45), (0, 4.8, 0, 0.55, 0.55), (0, 3.6, 8, 0.35, 0.35), (0, 0.4, 14, 0.12, 0.12)], BONE, segs=10)]
    for i, z in enumerate(np.linspace(-6, 5, 7)):
        k = 1.0 - 0.07 * abs(i - 2)
        for sx in (-1, 1):
            p.append(loft([(0, 4.6, z, 0.3, 0.3), (sx * 3.0 * k, 5.0 * k, z, 0.26, 0.26), (sx * 4.2 * k, 2.6 * k, z + 0.3, 0.2, 0.2),
                           (sx * 3.3 * k, -0.2, z + 0.5, 0.1, 0.1)], BONE, segs=7, side=(0, 0, 1)))
        p.append(spike((0, 4.9, z), (0, 6.0, z + 0.4), 0.22, BONE, segs=5))
    p += [blob((0, 3.2, -10), (1.7, 1.5, 2.6), BONE, sub=2, bump=0.15, freq=2.0),
          blob((0, 1.9, -10.8), (1.3, 0.5, 2.3), BONE, sub=2)]
    for sx in (-1, 1):
        p.append(blob((sx * 1.2, 3.6, -10.6), (0.5, 0.45, 0.6), MOUTH, sub=1))
        p.append(spike((sx * 1.0, 4.4, -9.2), (sx * 2.2, 6.4, -7.8), 0.4, BONE))
        for z in np.linspace(-12.6, -10.2, 5):
            p.append(spike((sx * 0.9, 2.6, z), (sx * 0.9, 1.9, z), 0.14, BONE, segs=5))
    join('Ribcage', p, recenter=False)

    rock = mat_flat('MountainRock', 0x4a5a58, rough=1.0)
    snow = mat_flat('MountainMoss', 0x3a5a3c, rough=1.0)
    p = [blob((0, -8, 0), (70, 62, 42), rock, sub=3, bump=0.55, freq=1.5, flat=True, seed=40),
         blob((38, -10, 6), (48, 44, 34), rock, sub=3, bump=0.6, freq=1.7, flat=True, seed=41),
         blob((-34, -14, -4), (52, 36, 36), snow, sub=3, bump=0.5, freq=1.6, flat=True, seed=42)]
    join('Mountain', p, recenter=False)

    cloud = mat_flat('Cloud', 0xffffff, rough=1.0, glow=0xdfeaf5, glow_strength=0.55)
    p = [blob((x, y, z), r, cloud, sub=2, bump=0.25, freq=1.6, flat=True, seed=60 + i)
         for i, (x, y, z, r) in enumerate(((0, 0, 0, (16, 6, 10)), (13, -1, 2, (11, 4.5, 8)), (-12, -1.5, -1, (12, 4, 8)),
                                           (4, 3.5, -1, (9, 4.5, 7)), (-5, 2.5, 3, (8, 4, 6))))]
    join('Cloud', p, recenter=False)
    export(fname)


# ---------------------------------------------------------------------------------------------
# Sanctuary: blast gate, palisade, watchtowers, spit-roast camp, forge, hatchery, tents.
# Local origin is the centre of the gate; the camp lies towards +Z.
# ---------------------------------------------------------------------------------------------
def sanctuary(fname):
    reset()
    rng = np.random.default_rng(7)
    stone = [mat_flat(f'Block{i}', c, rough=0.95) for i, c in enumerate((0x5d646b, 0x4c535a, 0x6b7078))]
    steel = mat_flat('GateSteel', 0x3b4958, rough=0.5, metal=0.3)
    hazard = mat_flat('Hazard', 0xe0a010, rough=0.6)
    wood = mat_flat('Timber', 0x6e4a2e, rough=0.9)
    dark = mat_flat('TimberDark', 0x3d2a1b, rough=0.9)
    banner = mat_flat('Banner', 0x00a892, rough=0.8, double=True)
    lamp = mat_flat('Lantern', 0xffc46b, glow=0xff9a2e, glow_strength=6.0)
    beacon = mat_flat('Beacon', 0x00f5d4, glow=0x00f5d4, glow_strength=5.0)
    fire = [mat_flat('FireOuter', 0xff5a00, glow=0xff4a00, glow_strength=6.0), mat_flat('FireInner', 0xffd060, glow=0xffc040, glow_strength=8.0)]
    hide = mat_flat('Hide', 0x9a7b55, rough=0.95, double=True)
    straw = mat_flat('Straw', 0xc9a24a, rough=1.0)
    eggs = [mat_flat('EggCream', 0xe6dcc4, rough=0.5), mat_flat('EggTeal', 0x2bb8a8, rough=0.3, glow=0x00f5d4, glow_strength=1.5),
            mat_flat('EggRose', 0xc65a7a, rough=0.4)]
    mh = fbm(512, 6, 6, 77)
    mcol = rgb(0x5a2414) * (1 - mh[..., None]) + rgb(0xb5632e) * mh[..., None]
    meat = mat_tex('Roast', image('Roast_base', mcol), image('Roast_nrm', normal_from_height(mh, 4.0), data=True), rough=0.45)
    post = lambda x, z, h, r=0.18, m=dark: spike((x, 0, z), (x, h, z), r, m, segs=7, r2=r)
    p = []

    # Gate towers, blast doors, arch
    for sx in (-1, 1):
        for row in range(9):
            for k in range(2):
                for m in range(2):
                    c = (sx * 14 + (k - 0.5) * 2.5 + rng.uniform(-0.08, 0.08), 1 + row * 2, (m - 0.5) * 2.5)
                    p.append(box(c, (2.45, 1.95, 2.45), stone[rng.integers(3)], 0.18, rot=(0, rng.uniform(-0.05, 0.05), 0)))
        p += [box((sx * 14, 18.5, 0), (6.2, 0.9, 6.2), steel, 0.15), box((sx * 14, 20.6, 0), (1.1, 1.3, 1.1), beacon, 0.15),
              box((sx * 14, 19.5, 0), (0.5, 1.2, 0.5), steel), box((sx * 10.0, 7.2, 0.5), (4.6, 14.4, 0.9), steel, 0.12),
              box((sx * 10.0, 7.2, 0.0), (3.6, 1.0, 0.25), steel, 0.05), box((sx * 14, 10.5, -2.75), (3.2, 7.5, 0.06), banner),
              plate((sx * 14 - 0.0, 9.6, -2.86), 2.6, 1.9, 0.06, hazard)]
        p[-1].data.transform(Matrix.Translation(B((sx * 14, 9.6, -2.86))) @ Matrix.Rotation(math.pi / 2, 4, 'Z') @ Matrix.Translation(-B((sx * 14, 9.6, -2.86))))
        for y in (2.2, 4.4, 10.2, 12.4):
            p.append(box((sx * 10.0, y, -0.02), (4.7, 0.5, 0.12), hazard, rot=(0, 0, sx * 0.5)))
        for dx in (-2.5, 2.5):
            for dz in (-2.5, 2.5):
                p.append(box((sx * 14 + dx, 19.5, dz), (1.1, 1.2, 1.1), stone[1], 0.12))
        p.append(post(sx * 11.5, -4.0, 4.6))
        p.append(blob((sx * 11.5, 5.0, -4.0), (0.5, 0.6, 0.5), fire[0], sub=1, flat=True))
    p += [box((0, 17.2, 0), (24.5, 2.4, 3.4), steel, 0.2), box((0, 15.85, -1.72), (23, 0.45, 0.1), hazard)]
    for x in (-8, -4, 0, 4, 8):
        p.append(box((x, 15.8, 0), (0.9, 0.35, 0.9), lamp))

    # Sharpened-log palisade running out from the gate and back along both flanks
    stakes = [(sx * (17.6 + i * 1.35), 0.0) for sx in (-1, 1) for i in range(34)]
    stakes += [(sx * 62.2, 1.35 + i * 1.35) for sx in (-1, 1) for i in range(46)]
    for x, z in stakes:
        h = 7.0 + rng.uniform(0, 1.6)
        r = 0.66 + rng.uniform(-0.06, 0.06)
        p.append(spike((x, -0.3, z), (x + rng.uniform(-0.12, 0.12), h, z), r, wood if rng.random() > 0.3 else dark, segs=7, r2=r * 0.9))
        p.append(spike((x, h, z), (x, h + 1.3, z), r * 0.9, wood, segs=7))
    for sx in (-1, 1):
        for y in (2.2, 5.4):
            p.append(box((sx * 39.8, y, -0.72), (45.5, 0.4, 0.3), dark))
            p.append(box((sx * 62.95, y, 32.0), (0.3, 0.4, 62.5), dark))

    # Watchtowers just inside the wall
    for sx in (-1, 1):
        cx, cz = sx * 24.0, 7.0
        for dx in (-1.8, 1.8):
            for dz in (-1.8, 1.8):
                p.append(post(cx + dx, cz + dz, 12.5, 0.24))
        p += [box((cx, 9.0, cz), (4.6, 0.3, 4.6), wood), box((cx, 10.1, cz - 2.2), (4.6, 0.2, 0.2), dark),
              box((cx - 2.2, 10.1, cz), (0.2, 0.2, 4.6), dark), box((cx + 2.2, 10.1, cz), (0.2, 0.2, 4.6), dark),
              spike((cx, 12.4, cz), (cx, 15.2, cz), 4.0, straw, segs=4), blob((cx, 11.6, cz), (0.35,) * 3, lamp, sub=1, flat=True),
              box((cx, 4.5, cz + 1.8), (0.2, 9.4, 0.2), dark, rot=(0.0, 0, 0.38)), box((cx, 4.5, cz - 1.8), (0.2, 9.4, 0.2), dark, rot=(0, 0, -0.38))]

    # Campfire with the Grand Spit-Roast
    fx, fz = -8.0, 10.0
    for i in range(10):
        a = i * math.pi / 5
        p.append(blob((fx + math.cos(a) * 1.9, 0.25, fz + math.sin(a) * 1.9), (0.55, 0.4, 0.5), stone[i % 3], sub=1, bump=0.3, freq=2, flat=True, seed=i))
    for i in range(4):
        a = i * math.pi / 4
        p.append(spike((fx - math.cos(a) * 1.3, 0.25, fz - math.sin(a) * 1.3), (fx + math.cos(a) * 1.3, 0.55, fz + math.sin(a) * 1.3), 0.22, dark, segs=7, r2=0.2))
    for dx, dz, h, m in ((0, 0, 2.3, 0), (0.5, 0.3, 1.5, 0), (-0.5, -0.2, 1.7, 0), (0.1, -0.1, 1.5, 1), (-0.2, 0.3, 1.0, 1)):
        p.append(spike((fx + dx, 0.3, fz + dz), (fx + dx * 1.3, 0.3 + h, fz + dz * 1.3), 0.62 if m == 0 else 0.4, fire[m], segs=6))
    for sx in (-1, 1):
        x = fx + sx * 3.3
        p += [post(x, fz, 3.4, 0.16, wood), spike((x, 3.2, fz), (x - 0.5, 4.0, fz), 0.12, wood, segs=6, r2=0.1),
              spike((x, 3.2, fz), (x + 0.5, 4.0, fz), 0.12, wood, segs=6, r2=0.1)]
    for i, a in enumerate((0.6, 2.2, 3.9)):
        c = np.array([fx + math.cos(a) * 5.2, 0.55, fz + math.sin(a) * 5.2])
        d = np.array([-math.sin(a), 0, math.cos(a)]) * 2.2
        p.append(spike(c - d, c + d, 0.55, wood, segs=9, r2=0.5))

    # Forge, anvil and weapon rack
    gx, gz = 9.5, 13.0
    p += [box((gx, 1.4, gz), (4.0, 2.8, 3.4), stone[0], 0.2), box((gx, 1.3, gz - 1.72), (1.8, 1.3, 0.12), fire[0]),
          box((gx, 1.3, gz - 1.76), (2.2, 0.2, 0.12), steel), spike((gx, 2.8, gz), (gx, 7.0, gz), 1.5, stone[1], segs=4, r2=0.7),
          box((gx - 3.8, 0.45, gz - 2.2), (0.9, 0.9, 0.7), dark), box((gx - 3.8, 1.05, gz - 2.2), (1.5, 0.35, 0.6), steel, 0.05),
          spike((gx - 4.5, 1.05, gz - 2.2), (gx - 5.4, 1.1, gz - 2.2), 0.2, steel, segs=7),
          post(gx + 3.6, gz - 2.6, 3.2), post(gx + 6.4, gz - 2.6, 3.2), box((gx + 5.0, 3.0, gz - 2.6), (3.2, 0.2, 0.2), dark),
          box((gx + 5.0, 1.2, gz - 2.6), (3.2, 0.2, 0.2), dark)]
    for i, x in enumerate((gx + 4.1, gx + 5.0, gx + 5.9)):
        p.append(spike((x, 0.3, gz - 2.75), (x, 2.4, gz - 2.75), 0.06, dark, segs=6, r2=0.06))
        p.append(spike((x, 2.5, gz - 2.8), (x, 2.5, gz - 2.7), 0.55 - 0.08 * i, steel, segs=14, r2=0.55 - 0.08 * i))
        p.append(spike((x, 2.5, gz - 2.82), (x, 2.5, gz - 2.68), 0.2, beacon, segs=8, r2=0.2))

    # Hatchery nest
    nx, nz = -13.0, 23.0
    for i in range(12):
        a = i * math.pi / 6
        p.append(blob((nx + math.cos(a) * 2.2, 0.45, nz + math.sin(a) * 2.2), (0.9, 0.55, 0.9), straw, sub=1, bump=0.4, freq=2, flat=True, seed=i))
    p.append(blob((nx, 0.15, nz), (2.2, 0.3, 2.2), straw, sub=1, flat=True))
    for i, (dx, dz) in enumerate(((0, 0.5), (0.9, -0.5), (-0.9, -0.4))):
        p.append(blob((nx + dx, 1.1, nz + dz), (0.62, 0.9, 0.62), eggs[i], sub=2))
    p += [post(nx + 3.0, nz, 4.2), box((nx + 2.4, 4.2, nz), (1.4, 0.15, 0.15), dark), blob((nx + 1.8, 3.8, nz), (0.4,) * 3, lamp, sub=1, flat=True)]

    # Hide tents, crates, barrels, lamp posts
    for tx, tz, yaw in ((12.0, 26.0, 0.4), (-3.0, 33.0, -0.3), (22.0, 34.0, 1.2)):
        cy, sy = math.cos(yaw), math.sin(yaw)
        for s in (-1, 1):
            p.append(box((tx + s * 1.35 * cy, 1.9, tz - s * 1.35 * sy), (0.08, 4.6, 6.0), hide, rot=(0, yaw, s * 0.62)))
        p.append(spike((tx - 3.2 * sy, 3.75, tz - 3.2 * cy), (tx + 3.2 * sy, 3.75, tz + 3.2 * cy), 0.1, dark, segs=6, r2=0.1))
    for cx, cz, s in ((5.0, 5.0, 1.4), (6.6, 5.4, 1.1), (5.6, 5.2, 0.9), (-6.0, 4.0, 1.3), (17.0, 20.0, 1.5)):
        y = s / 2 if (cx, s) != (5.6, 0.9) else 1.4 + s / 2
        p += [box((cx, y, cz), (s, s, s), wood, 0.05, rot=(0, cx, 0)), box((cx, y, cz), (s * 1.04, s * 0.14, s * 1.04), dark, rot=(0, cx, 0))]
    for cx, cz in ((-5.0, 5.6), (-4.0, 4.4), (16.0, 22.5)):
        p += [spike((cx, 0, cz), (cx, 1.5, cz), 0.6, wood, segs=10, r2=0.6), spike((cx, 0.35, cz), (cx, 0.5, cz), 0.64, steel, segs=10, r2=0.64),
              spike((cx, 1.0, cz), (cx, 1.15, cz), 0.64, steel, segs=10, r2=0.64)]
    for sx in (-1, 1):
        for z in (7.0, 19.0, 31.0):
            x = sx * 7.5
            p += [post(x, z, 4.6, 0.13), box((x - sx * 0.6, 4.5, z), (1.3, 0.12, 0.12), dark),
                  box((x - sx * 1.1, 4.0, z), (0.45, 0.6, 0.45), lamp, 0.06), box((x - sx * 1.1, 4.38, z), (0.6, 0.12, 0.6), dark)]
    join('Sanctuary', p, recenter=False)

    roast = [spike((fx - 3.9, 3.6, fz), (fx + 4.3, 3.6, fz), 0.08, steel, segs=6, r2=0.08),
             loft([(fx - 2.0, 3.6, fz, 0.45, 0.45), (fx - 1.1, 3.6, fz, 1.0, 1.15), (fx + 0.3, 3.6, fz, 1.15, 1.0), (fx + 1.5, 3.6, fz, 0.6, 0.6)], meat, segs=14, side=(0, 0, 1)),
             spike((fx + 1.3, 3.6, fz), (fx + 2.4, 3.6, fz), 0.16, BONE, segs=6, r2=0.14), blob((fx + 2.5, 3.6, fz), (0.3, 0.28, 0.3), BONE, sub=1),
             spike((fx + 4.3, 3.6, fz), (fx + 4.3, 3.0, fz), 0.07, steel, segs=6, r2=0.07)]
    roast_ob = join('Spit_Roast', roast, recenter=False)
    pivot = B((fx, 3.6, fz))
    roast_ob.data.transform(Matrix.Translation(-pivot))
    roast_ob.location = pivot
    export(fname)


# ---------------------------------------------------------------------------------------------
# Hand-held props: loot chunks, the squad hunter and the first-person Plasma Cleaver
# ---------------------------------------------------------------------------------------------
def props(fname):
    reset()
    mh = fbm(512, 5, 5, 91)
    fat = smooth(fbm(512, 14, 3, 93), 0.62, 0.72)[..., None]
    mcol = (rgb(0x7a1020) * (1 - mh[..., None]) + rgb(0xc4283a) * mh[..., None]) * (1 - fat) + rgb(0xf0d8c8) * fat
    meat = mat_tex('RawMeat', image('RawMeat_base', mcol), image('RawMeat_nrm', normal_from_height(mh, 3.0), data=True), rough=0.35)
    heart = mat_flat('HeartCrystal', 0x00f5d4, rough=0.15, glow=0x00bbf9, glow_strength=4.0)
    vein = mat_flat('HeartVein', 0x12303a, rough=0.5)
    amber = mat_flat('PlateAmber', 0xff9f1c, rough=0.3, glow=0xff8a14, glow_strength=1.2)
    steel = mat_flat('BladeSteel', 0x2a3340, rough=0.3, metal=0.35)
    edge = mat_flat('PlasmaEdge', 0x00f5d4, rough=0.2, glow=0x00f5d4, glow_strength=5.0)
    grip = mat_flat('Grip', 0x2b1d14, rough=0.9)
    suit = mat_flat('Suit', 0x1f4d4a, rough=0.7)
    armour = mat_flat('SuitArmour', 0xd97706, rough=0.5, metal=0.2)
    black = mat_flat('SuitDark', 0x15191e, rough=0.6)

    join('Chunk_Steak', [
        loft([(-1.2, 0, 0, 0.3, 0.5), (-0.5, 0, 0, 0.5, 0.95), (0.5, 0, 0, 0.55, 1.0), (1.15, 0, 0, 0.3, 0.5)], meat, segs=14, side=(0, 0, 1)),
        spike((0.9, 0, 0), (2.0, 0.05, 0), 0.17, BONE, segs=7, r2=0.14), blob((2.05, 0.05, 0.14), (0.24,) * 3, BONE, sub=1),
        blob((2.05, 0.05, -0.14), (0.24,) * 3, BONE, sub=1)])

    p = [blob((0, 0, 0), (1.25, 1.4, 1.2), heart, sub=1, flat=True)]
    for i in range(7):
        a, e = i * 2.4, (i % 3 - 1) * 0.7
        d = np.array([math.cos(a) * math.cos(e), math.sin(e), math.sin(a) * math.cos(e)])
        p.append(spike(d * 0.8, d * (1.9 + 0.3 * (i % 2)), 0.36, heart, segs=5))
    for sx in (-1, 1):
        p.append(loft([(sx * 0.3, 1.0, 0, 0.3, 0.3), (sx * 0.6, 1.8, 0.1, 0.22, 0.22), (sx * 1.2, 2.2, 0.2, 0.16, 0.16)], vein, segs=8))
    join('Chunk_Heart', p)

    p = [blob((0, 0, 0), (1.5, 0.7, 1.8), BONE, sub=2, bump=0.2, freq=2.0), blob((0, -0.3, -1.3), (1.0, 0.4, 1.3), BONE, sub=2)]
    for sx in (-1, 1):
        p += [blob((sx * 0.75, 0.25, -0.7), (0.4, 0.3, 0.45), MOUTH, sub=1), spike((sx * 0.9, 0.4, 0.5), (sx * 2.0, 1.7, 1.5), 0.4, amber)]
        for z in np.linspace(-2.3, -0.9, 4):
            p.append(spike((sx * 0.7, -0.5, z), (sx * 0.7, -1.1, z), 0.14, BONE, segs=5))
    join('Chunk_Skull', p)

    join('Chunk_Plate', [plate((0, -1.0, 0), 2.4, 2.0, 0.35, amber), blob((0, -1.0, 0), (0.6, 0.45, 1.1), meat, sub=1)])
    join('Chunk_Claw', [blob((0, 0, 0), (0.45, 0.4, 0.5), meat, sub=1)] +
         [spike((dx, 0, -0.2), (dx * 1.6, -0.5, -1.5), 0.2, BONE) for dx in (-0.3, 0, 0.3)])

    # Squad hunter: stands on the origin, faces -Z, about 2.1 units tall
    p = [loft([(0, 1.0, 0, 0.34, 0.24), (0, 1.35, 0, 0.36, 0.25), (0, 1.65, 0, 0.44, 0.28), (0, 1.84, 0, 0.26, 0.2)], suit, segs=12, side=(1, 0, 0)),
         box((0, 1.52, -0.24), (0.56, 0.42, 0.12), armour, 0.04), box((0, 1.02, 0), (0.74, 0.14, 0.54), black, 0.03),
         blob((0, 2.03, 0), (0.25, 0.27, 0.27), black, sub=2), blob((0, 2.04, -0.15), (0.2, 0.1, 0.15), edge, sub=2),
         box((0, 2.28, -0.12), (0.12, 0.1, 0.12), mat_flat('HeadLamp', 0xfff3c4, glow=0xffe9a8, glow_strength=5.0)),
         box((0, 1.45, 0.34), (0.52, 0.62, 0.26), armour, 0.05), box((0.12, 1.55, 0.5), (0.1, 1.5, 0.06), steel, rot=(0, 0, 0.5)),
         box((0.2, 1.42, 0.52), (0.04, 1.3, 0.05), edge, rot=(0, 0, 0.5))]
    for sx in (-1, 1):
        p += [loft([(sx * 0.2, 1.0, 0, 0.2, 0.22), (sx * 0.22, 0.52, -0.03, 0.16, 0.18), (sx * 0.22, 0.1, 0, 0.15, 0.16)], suit, segs=10),
              box((sx * 0.22, 0.1, -0.08), (0.3, 0.2, 0.52), black, 0.04), box((sx * 0.22, 0.56, -0.17), (0.22, 0.2, 0.1), armour, 0.03),
              loft([(sx * 0.5, 1.72, 0, 0.14, 0.14), (sx * 0.58, 1.3, -0.05, 0.12, 0.12), (sx * 0.5, 0.98, -0.25, 0.1, 0.1)], suit, segs=8),
              blob((sx * 0.5, 0.92, -0.28), (0.12,) * 3, black, sub=1), box((sx * 0.5, 1.76, 0), (0.3, 0.16, 0.34), armour, 0.05)]
    join('Hunter', p, recenter=False)

    # Plasma Great-Cleaver: grip on the origin, blade pointing along -Z
    p = [spike((0, 0, 0.42), (0, 0, -0.04), 0.045, grip, segs=8, r2=0.05), blob((0, 0, 0.45), (0.07,) * 3, steel, sub=1),
         box((0, 0, -0.08), (0.11, 0.26, 0.07), steel, 0.02), box((0, 0.04, -0.78), (0.045, 0.34, 1.3), steel, 0.015),
         box((0, 0.1, -1.47), (0.045, 0.24, 0.2), steel, 0.015, rot=(0.5, 0, 0)), box((0, 0.1, -0.75), (0.055, 0.07, 1.0), amber),
         box((0, -0.15, -0.8), (0.03, 0.06, 1.34), edge)]
    for z in np.linspace(-1.35, -0.25, 9):
        p.append(spike((0, -0.15, z), (0, -0.27, z - 0.05), 0.05, edge, segs=4))
    join('Cleaver', p, recenter=False)
    export(fname)


print(f'Building models into {OUT}')
theropod('voltaic_rex', dino_mats('Rex', 0x1c2b33, 0x8f8a6a, 0x0b1216, 0x00f5d4, 0x00d9bc, 0xffd000, 1))
theropod('shadow_raptor', dino_mats('Raptor', 0x1a1423, 0x4a3a55, 0x07050a, 0xff0055, 0xff0055, 0xff2a5f, 2, stripes=9),
         g=0.62, hs=0.82, hw=0.72, arm=1.7, quills=True)
stego('stego_titan', dino_mats('Stego', 0x34503a, 0xa39a6c, 0x16241a, 0xff9f1c, 0xff8a14, 0xffb000, 3, stripes=8))
bronto('bronto')
truck('truck')
environment('environment')
sanctuary('sanctuary')
props('props')
print('Done.')
