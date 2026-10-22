# Retire les marqueurs « arbre abattu » (pastille saumon + croix) des vues de l'éditeur BVE par détection de teinte + inpainting OpenCV.
import cv2, numpy as np, sys
def clean(src, dst):
    im = cv2.imread(src); hsv = cv2.cvtColor(im, cv2.COLOR_BGR2HSV)
    b, g, r = [im[..., i].astype(int) for i in range(3)]
    sal = (r > 195) & (r < 240) & (g > 92) & (g < 130) & (b > 82) & (b < 120) & (abs(g - b) < 22)         # saumon du marqueur
    sal = sal.astype(np.uint8) * 255
    n, lab, st, _ = cv2.connectedComponentsWithStats(sal)
    mask = np.zeros_like(sal)
    for i in range(1, n):
        x, y, w, h, a = st[i]
        if 40 <= a and 6 <= w <= 40 and 6 <= h <= 40: mask[lab == i] = 255           # taille d'une pastille
    mask = cv2.dilate(mask, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (9, 9)), iterations=2)
    out = cv2.inpaint(im, mask, 7, cv2.INPAINT_TELEA); cv2.imwrite(dst, out); return int(n)
if __name__ == '__main__': print(clean(sys.argv[1], sys.argv[2]))
