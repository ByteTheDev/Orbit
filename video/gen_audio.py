import numpy as np
import soundfile as sf
import os

SR = 44100
OUT = r"C:\Users\spoil\OneDrive\Desktop\Orbit\video\public\audio"
os.makedirs(OUT, exist_ok=True)
np.random.seed(7)

def fade(x, a=0.005, b=0.08):
    n = len(x)
    env = np.ones(n)
    la = int(a*SR); lb = int(b*SR)
    if la>0: env[:la] = np.linspace(0,1,la)
    if lb>0: env[-lb:] = np.linspace(1,0,lb)
    return x*env

def write(name, x):
    x = np.clip(x, -1, 1)
    sf.write(os.path.join(OUT, name), x.astype(np.float32), SR)
    print("wrote", name, round(len(x)/SR, 2), "s")

def lowpass_fft(x, cutoff):
    # vectorized FFT lowpass (no python per-sample loop)
    n = len(x)
    spec = np.fft.rfft(x)
    freqs = np.fft.rfftfreq(n, 1/SR)
    # smooth rolloff
    gain = 1.0 / (1.0 + (freqs / cutoff)**2)
    return np.fft.irfft(spec * gain, n)

def mtof(m): return 440.0 * 2**((m - 69)/12)

def tri(phase):
    # phase in radians -> triangle -1..1
    return 2/np.pi * np.arcsin(np.sin(phase)) * 1.2

def saw(phase):
    return 2*(phase/(2*np.pi) - np.floor(0.5 + phase/(2*np.pi)))

def adsr_env(n, a, d, s, r, dur_s):
    # time in samples n, attack/decay/sustain/release in seconds, sustain level s
    a_n = int(a*SR); d_n = int(d*SR); r_n = int(r*SR)
    env = np.zeros(n)
    # attack
    env[:a_n] = np.linspace(0, 1, a_n)
    # decay to sustain
    end = min(a_n+d_n, n)
    env[a_n:end] = np.linspace(1, s, end-a_n)
    if r_n > 0:
        env[-r_n:] = np.linspace(s, 0, r_n)
    else:
        env[a_n+d_n:] = s
    return env

# ============ SFX (kept, softened) ============
# impact
dur = 0.7
t = np.linspace(0, dur, int(dur*SR))
inst_f = 40 + 100*np.exp(-t*4)
phase = 2*np.pi*np.cumsum(inst_f)/SR
tone = np.sin(phase) * np.exp(-t*3.5)
noise = lowpass_fft(np.random.uniform(-1,1,len(t)), 800) * np.exp(-t*6) * 0.35
write("impact.wav", fade(tone*0.85 + noise, 0.001, 0.12))

# whoosh
dur = 0.55
n = int(dur*SR)
x = np.random.uniform(-1,1,n)
env = np.sin(np.linspace(0, np.pi, n))**1.3
dry = lowpass_fft(x, 500)
bright = lowpass_fft(x, 4500) - lowpass_fft(x, 800)
mix = np.linspace(0, 1, n)
y = dry*(1-mix*0.5) + bright*(mix*0.6)
write("whoosh.wav", fade(y*env*0.7, 0.01, 0.1))

# click
dur = 0.07
t = np.linspace(0, dur, int(dur*SR))
x = np.random.uniform(-1,1,len(t)) * np.exp(-t*70)
x = lowpass_fft(x, 6000)
x += 0.4*np.sin(2*np.pi*2200*t)*np.exp(-t*90)
write("click.wav", fade(x*0.7, 0.001, 0.015))

# pop
dur = 0.14
t = np.linspace(0, dur, int(dur*SR))
inst_f = 280 + 900*(t/dur)**2
phase = 2*np.pi*np.cumsum(inst_f)/SR
write("pop.wav", fade(np.sin(phase)*np.exp(-t*10)*0.7, 0.001, 0.03))

# riser
dur = 1.6
t = np.linspace(0, dur, int(dur*SR))
inst_f = 110 + (760-110)*(t/dur)**2
phase = 2*np.pi*np.cumsum(inst_f)/SR
x = 0.35*np.sin(phase)*(t/dur) + 0.08*lowpass_fft(np.random.uniform(-1,1,len(t)), 1200)*(t/dur)
write("riser.wav", fade(x, 0.02, 0.12))

# ding
dur = 0.7
t = np.linspace(0, dur, int(dur*SR))
x = 0.5*np.sin(2*np.pi*880*t)*np.exp(-t*3.2) + 0.18*np.sin(2*np.pi*1760*t)*np.exp(-t*4.5)
t2 = np.clip(t-0.09, 0, None)
x += (t>=0.09)*0.4*np.sin(2*np.pi*1174.66*t2)*np.exp(-t2*3.2)
write("ding.wav", fade(x*0.7, 0.001, 0.18))

# glitch
dur = 0.35
n = int(dur*SR)
x = np.random.uniform(-1,1,n)
x = lowpass_fft(x, 5000)
gate = (np.sin(2*np.pi*36*np.arange(n)/SR)>0).astype(float)
x = x*gate*0.55
x = np.round(x*10)/10
write("glitch.wav", fade(x, 0.001, 0.05))

# swoosh
dur = 0.6
n = int(dur*SR)
x = lowpass_fft(np.random.uniform(-1,1,n), 900)
env = np.sin(np.linspace(0, np.pi, n))**2
write("swoosh.wav", fade(x*env*0.7, 0.02, 0.12))

# success
dur = 0.9
x = np.zeros(int(dur*SR))
notes = [523.25, 659.25, 783.99, 1046.5]
for idx, f in enumerate(notes):
    start = int(idx*0.11*SR)
    local = np.arange(len(x)-start)/SR
    x[start:] += 0.28*np.sin(2*np.pi*f*local)*np.exp(-local*4.2)
write("success.wav", fade(x, 0.001, 0.22))

# ============ MUSIC: 24s, 100 BPM, Am–F–C–G ============
# 10 bars x 2.4s = 24.0s
BPM = 100
BAR = 60/BPM*4  # 2.4s
BEAT = 60/BPM    # 0.6s
DUR = 24.0
N = int(DUR*SR)
music = np.zeros(N)

# chords per bar: (bass midi, pad midis)
CHORDS = [
    (33, [57, 60, 64]),  # Am  (A1 bass? use A2=45? keep 45 range: actually 33 is A1 too low; use 45)
    (41, [53, 57, 60]),  # F
    (36, [60, 64, 67]),  # C
    (43, [55, 59, 62]),  # G
]
# use proper bass roots
BASSES = [45, 41, 36, 43]  # A2, F2, C2, G2 (C2=36 ok)
PADS = [[57,60,64],[53,57,60],[60,64,67],[55,59,62]]
PROG = [0,1,2,3,0,1,2,3,0,0]  # 10 bars

def add_note(buf, start_s, dur_s, midi, gain, timbre="tri", attack=0.01, decay=0.15):
    s = int(start_s*SR); e = int((start_s+dur_s)*SR)
    if s >= len(buf): return
    e = min(e, len(buf))
    n = e-s
    if n <= 0: return
    t = np.arange(n)/SR
    f = mtof(midi)
    ph = 2*np.pi*f*t
    if timbre == "tri":
        sig = tri(ph)
    elif timbre == "sine":
        sig = np.sin(ph)
    elif timbre == "pluck":
        # triangle + sine octave, fast decay
        sig = tri(ph)*0.7 + np.sin(ph*2)*0.3
        env = np.exp(-t/0.16)
        buf[s:e] += sig*env*gain
        return
    else:
        sig = np.sin(ph)
    # simple env: attack, sustain, release last 30%
    env = np.ones(n)
    a_n = int(attack*SR)
    r_n = int(dur_s*0.35*SR)
    if a_n>0: env[:a_n] = np.linspace(0,1,a_n)
    if r_n>0: env[-r_n:] = np.linspace(1,0,r_n)
    buf[s:e] += sig*env*gain

# --- PAD layer (soft, sustained) ---
for bar in range(10):
    ci = PROG[bar]
    t0 = bar*BAR
    chord = PADS[ci]
    # add slight human swing: pad starts on the bar
    for m in chord:
        # detuned pair for chorus width
        add_note(music, t0, BAR+0.4, m, 0.055, "tri", attack=0.5)
        add_note(music, t0+0.02, BAR+0.4, m+0.0, 0.03, "sine", attack=0.6)
    # octave top shimmer
    add_note(music, t0+BAR*0.5, BAR*0.5+0.3, chord[0]+12, 0.02, "sine", attack=0.4)

# --- BASS layer ---
for bar in range(10):
    ci = PROG[bar]
    root = BASSES[ci]
    t0 = bar*BAR
    # beat 1 and 3 (sustained), plus pickup on beat 4.5
    add_note(music, t0, BEAT*1.8, root, 0.32, "sine", attack=0.02)
    add_note(music, t0, BEAT*1.8, root+12, 0.10, "tri", attack=0.02)
    add_note(music, t0+BEAT*2, BEAT*1.8, root, 0.30, "sine", attack=0.02)
    add_note(music, t0+BEAT*2, BEAT*1.8, root+12, 0.09, "tri", attack=0.02)
    # walking pickup: fifth on beat 4.5
    add_note(music, t0+BEAT*3.5, BEAT*0.5, root+7, 0.12, "sine", attack=0.01)

# --- ARP / PLUCK layer (8th notes, chord tones) ---
# pattern indices into chord + octave
for bar in range(10):
    ci = PROG[bar]
    t0 = bar*BAR
    chord = PADS[ci]
    arp = [chord[0]+12, chord[1]+12, chord[2]+12, chord[1]+12,
           chord[0]+12, chord[2]+12, chord[1]+12, chord[2]+12]
    # last bar: sparser
    if bar == 9:
        arp = arp[:4] + [chord[0]+12]*4
    for i, m in enumerate(arp):
        st = t0 + i*(BEAT/2)
        # velocity drops on second half of bar 9
        g = 0.13 if bar < 9 else 0.07
        add_note(music, st, 0.28, m, g, "pluck")

# --- DRUMS (soft, minimal) ---
# kick: beats 1 & 3
for bar in range(10):
    for b in [0, 2]:
        st = bar*BAR + b*BEAT
        # kick: integrated drop
        n = int(0.20*SR)
        kt = np.arange(n)/SR
        inst_f = 45 + 105*np.exp(-kt*9)
        kp = 2*np.pi*np.cumsum(inst_f)/SR
        s = int(st*SR)
        if s+n <= N:
            music[s:s+n] += (np.sin(kp)*np.exp(-kt*10)*0.55)
    # snare on 2 & 4 (soft noise) — skip bar 9 (outro)
    if bar < 9:
        for b in [1, 3]:
            st = bar*BAR + b*BEAT
            n = int(0.12*SR)
            nz = lowpass_fft(np.random.uniform(-1,1,n), 3200) * np.exp(-np.arange(n)/SR*22)*0.16
            s = int(st*SR)
            if s+n <= N:
                music[s:s+n] += nz
    # hats on 8ths
    for i in range(8):
        st = bar*BAR + i*(BEAT/2)
        if bar == 9 and i > 3:
            continue
        n = int(0.04*SR)
        hz = (np.random.uniform(-1,1,n)) * np.exp(-np.arange(n)/SR*45)*0.05
        hz = lowpass_fft(hz, 9000) - lowpass_fft(hz, 4000)
        s = int(st*SR)
        if s+n <= N:
            music[s:s+n] += hz

# --- Delay echo on arp (dotted 8th ≈ 0.45s) ---
wet = np.zeros(N)
d = int(0.45*SR)
wet[d:] = music[:N-d]*0.14
wet[2*d:] += music[:N-2*d]*0.07
music = music + lowpass_fft(wet, 3500)

# --- Master: gentle lowpass, soft clip, fades ---
music = lowpass_fft(music, 9500)
# tanh soft limiter
music = np.tanh(music*1.15)
# normalize to -3dB
peak = np.max(np.abs(music))
music = music / peak * 0.71
# fades
fi = int(0.8*SR); fo = int(1.4*SR)
music[:fi] *= np.linspace(0,1,fi)
music[-fo:] *= np.linspace(1,0,fo)

# subtle stereo width: R delayed by 8 samples (no wraparound)
r_chan = np.zeros_like(music)
r_chan[8:] = music[:-8] * 0.99
stereo = np.column_stack([music, r_chan])
sf.write(os.path.join(OUT, "music.wav"), stereo.astype(np.float32), SR)
print("wrote music.wav", round(N/SR,2), "s stereo")

# Backwards-compat stubs (old layers no longer used, but keep files so nothing breaks)
write("ambient.wav", fade(np.zeros(int(0.5*SR)), 0.01, 0.1))
write("beat.wav", fade(np.zeros(int(0.5*SR)), 0.01, 0.1))

print("ALL DONE")
