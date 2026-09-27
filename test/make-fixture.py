"""Builds minimal but structurally valid MP4s with KNOWN values,
so the probe can be verified rather than assumed."""
import struct, sys

def box(t, payload): return struct.pack('>I', len(payload)+8) + t.encode() + payload
def full(t, ver, flags, payload): return box(t, bytes([ver]) + flags.to_bytes(3,'big') + payload)

def tkhd(w, h, rot=0):
    p  = struct.pack('>IIIII', 0,0, 1, 0, 1000)      # create, mod, trackID, rsv, duration
    p += b'\0'*8                                      # reserved[2]
    p += struct.pack('>hhhh', 0,0,0,0)                # layer, altgroup, volume, rsv
    M = {0:[0x10000,0,0, 0,0x10000,0, 0,0,0x40000000],
         90:[0,0x10000,0, -0x10000 & 0xFFFFFFFF,0,0, 0,0,0x40000000]}[rot]
    p += b''.join(struct.pack('>I', v & 0xFFFFFFFF) for v in M)
    p += struct.pack('>II', w<<16, h<<16)             # 16.16 fixed
    return full('tkhd', 0, 3, p)

def mdhd(timescale, duration):
    return full('mdhd',0,0, struct.pack('>IIII',0,0,timescale,duration) + struct.pack('>HH',0x55C4,0))

def hdlr(kind):
    return full('hdlr',0,0, b'\0'*4 + kind.encode() + b'\0'*12 + b'Vague\0')

def stts(entries):  # [(count, delta)]
    p = struct.pack('>I', len(entries))
    for c,d in entries: p += struct.pack('>II', c, d)
    return full('stts',0,0,p)

def colr(pri, trc, mtx, full_range=False):
    return box('colr', b'nclx' + struct.pack('>HHH', pri, trc, mtx) + bytes([0x80 if full_range else 0]))

def hvcC(bit_depth):
    # HEVCDecoderConfigurationRecord — real ISO layout
    #  16: reserved(6) + chromaFormatIdc(2)
    #  17: reserved(5) + bitDepthLumaMinus8(3)
    #  18: reserved(5) + bitDepthChromaMinus8(3)
    p = bytearray(23)
    p[0]  = 1
    p[16] = 0xFC | 1                       # chroma 4:2:0
    p[17] = 0xF8 | ((bit_depth-8) & 0x07)  # luma depth
    p[18] = 0xF8 | ((bit_depth-8) & 0x07)  # chroma depth
    return box('hvcC', bytes(p))

def dvcC(profile=8, level=6):
    p = bytearray(24); p[0]=1
    p[2] = (profile<<1) | ((level>>5)&1)
    p[3] = (level & 0x1F) << 3
    return box('dvcC', bytes(p))

def visual_entry(fmt, w, h, children=b''):
    p  = b'\0'*6 + struct.pack('>H',1)                       # SampleEntry
    p += struct.pack('>HH',0,0) + b'\0'*12                   # pre_defined/reserved
    p += struct.pack('>HH', w, h)
    p += struct.pack('>II', 0x480000, 0x480000)
    p += struct.pack('>I',0) + struct.pack('>H',1)
    p += b'\0'*32                                            # compressorname
    p += struct.pack('>HH', 24, 0xFFFF)
    return box(fmt, p + children)

def stsd(entry): return full('stsd',0,0, struct.pack('>I',1) + entry)

def trak(kind, w, h, timescale, stts_entries, entry, rot=0):
    stbl = box('stbl', stsd(entry) + stts(stts_entries))
    minf = box('minf', stbl)
    mdia = box('mdia', mdhd(timescale, sum(c*d for c,d in stts_entries)) + hdlr(kind) + minf)
    return box('trak', tkhd(w,h,rot) + mdia)

def build(path, *traks):
    ftyp = box('ftyp', b'isom' + struct.pack('>I',512) + b'isomiso2mp41')
    moov = box('moov', full('mvhd',0,0, struct.pack('>IIII',0,0,1000,1000)+b'\0'*80) + b''.join(traks))
    mdat = box('mdat', b'\0'*2048)
    open(path,'wb').write(ftyp + moov + mdat)
    print(f'  wrote {path}')

# A) 4K portrait 60fps HDR10/PQ 10-bit HEVC  + audio track (the contamination trap)
build('test/a_4k60_pq.mp4',
  trak('vide', 2160, 3840, 60000, [(600, 1000)],
       visual_entry('hvc1', 2160, 3840, colr(9,16,9) + hvcC(10))),
  trak('soun', 0, 0, 48000, [(469, 1024)], visual_entry('mp4a', 0, 0)))

# B) 1080p60 Dolby Vision 8.4
build('test/b_1080p60_dv.mp4',
  trak('vide', 1080, 1920, 60000, [(600, 1000)],
       visual_entry('hvc1', 1080, 1920, colr(9,18,9) + hvcC(10) + dvcC(8,6))))

# C) The CapCut signature: BT.2020 primaries, bt709 transfer, 8-bit
build('test/c_capcut_broken.mp4',
  trak('vide', 1080, 1920, 30000, [(300, 1000)],
       visual_entry('avc1', 1080, 1920, colr(9,1,1))))

# D) VFR 59.94 iPhone-style
build('test/d_vfr_5994.mp4',
  trak('vide', 1080, 1920, 600, [(200,10),(150,11),(100,9),(50,10)],
       visual_entry('hvc1', 1080, 1920, colr(9,18,9) + hvcC(10))))

# E) Rotated 90 (portrait stored as landscape)
build('test/e_rot90.mp4',
  trak('vide', 1920, 1080, 30000, [(300,1000)],
       visual_entry('avc1', 1920, 1080, colr(1,1,1)), rot=90))
