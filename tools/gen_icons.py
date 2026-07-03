#!/usr/bin/env python3
import math
import os
import struct
import zlib


def png(path, size):
    rows = []
    cx = cy = (size - 1) / 2.0
    for y in range(size):
        row = bytearray([0])
        for x in range(size):
            dx = x - cx
            dy = y - cy
            r = math.sqrt(dx * dx + dy * dy) / (size / 2.0)
            a = math.atan2(dy, dx)
            if r > 0.96:
                color = (16, 20, 24, 255)
            else:
                sky = int(max(0, min(1, 1 - r)) * 34)
                color = (18 + sky, 28 + sky, 36 + sky, 255)
            sunx = cx + math.cos(-0.75) * size * 0.18
            suny = cy + math.sin(-0.75) * size * 0.18
            sr = math.sqrt((x - sunx) ** 2 + (y - suny) ** 2)
            if sr < size * 0.115:
                glow = max(0, 1 - sr / (size * 0.115))
                color = (255, int(186 + 35 * glow), 92, 255)
            moonx = cx + math.cos(2.35) * size * 0.23
            moony = cy + math.sin(2.35) * size * 0.23
            mr = math.sqrt((x - moonx) ** 2 + (y - moony) ** 2)
            if mr < size * 0.085:
                color = (220, 233, 242, 255)
                if x < moonx:
                    color = (88, 103, 112, 255)
            if abs(r - 0.72) < 0.006 or abs(r - 0.42) < 0.006:
                color = (92, 198, 184, 255)
            if abs(dx) < 1.2 and y < cy - size * 0.22:
                color = (237, 244, 247, 255)
            row.extend(color)
        rows.append(bytes(row))
    raw = b''.join(rows)
    with open(path, 'wb') as f:
        f.write(b'\x89PNG\r\n\x1a\n')
        chunk(f, b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 6, 0, 0, 0))
        chunk(f, b'IDAT', zlib.compress(raw, 9))
        chunk(f, b'IEND', b'')


def chunk(f, name, data):
    f.write(struct.pack('>I', len(data)))
    f.write(name)
    f.write(data)
    f.write(struct.pack('>I', zlib.crc32(name + data) & 0xffffffff))


def main():
    os.makedirs('icons', exist_ok=True)
    png('icons/icon-192.png', 192)
    png('icons/icon-512.png', 512)
    png('icons/apple-touch-icon.png', 180)


if __name__ == '__main__':
    main()
