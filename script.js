// Footer year
document.getElementById("year").textContent = new Date().getFullYear();

// Snowfall
(function () {
  const canvas = document.getElementById("snow");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");

  let flakes = [];
  let w = 0;
  let h = 0;
  const MAX_FLAKES = 140;
  const prefersReduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function resize() {
    w = canvas.width = window.innerWidth;
    h = canvas.height = window.innerHeight;
  }

  function makeFlake(initial) {
    const size = 1.5 + Math.random() * 3.5;
    return {
      x: Math.random() * w,
      y: initial ? Math.random() * h : -size * 2 - Math.random() * 40,
      r: size,
      drift: 0.3 + Math.random() * 0.9,
      speed: 0.8 + Math.random() * 1.8,
      opacity: 0.35 + Math.random() * 0.6,
      phase: Math.random() * Math.PI * 2,
      spin: (Math.random() - 0.5) * 0.04,
    };
  }

  function draw() {
    ctx.clearRect(0, 0, w, h);
    for (const f of flakes) {
      if (prefersReduced && f.y > h) continue;
      f.phase += f.spin;
      f.y += f.speed;
      f.x += Math.sin(f.phase) * f.drift * 0.25 + 0.2;
      if (f.y > h + 10 || f.x > w + 10 || f.x < -10) {
        Object.assign(f, makeFlake(false));
      }
      ctx.beginPath();
      ctx.arc(f.x, f.y, f.r, 0, Math.PI * 2);
      ctx.globalAlpha = f.opacity;
      ctx.fillStyle = "#ffffff";
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    requestAnimationFrame(draw);
  }

  resize();
  const count = prefersReduced ? Math.min(MAX_FLAKES, 20) : MAX_FLAKES;
  flakes = Array.from({ length: count }, () => makeFlake(true));
  window.addEventListener("resize", resize);
  draw();
})();

// Nav: hide on scroll down, show on scroll up
const nav = document.querySelector(".nav");
let lastY = window.scrollY;

window.addEventListener("scroll", () => {
  const y = window.scrollY;
  if (y > lastY && y > 120) {
    nav.classList.add("hidden");
  } else {
    nav.classList.remove("hidden");
  }
  lastY = y;
});

// Reveal-on-scroll
const revealEls = document.querySelectorAll(".reveal");
if ("IntersectionObserver" in window) {
  const io = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("visible");
          io.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.15 }
  );
  revealEls.forEach((el) => io.observe(el));
} else {
  revealEls.forEach((el) => el.classList.add("visible"));
}

// Smooth-scroll offset for fixed nav on anchor clicks
document.querySelectorAll('a[href^="#"]').forEach((link) => {
  link.addEventListener("click", (e) => {
    const id = link.getAttribute("href");
    if (id.length > 1) {
      const target = document.querySelector(id);
      if (target) {
        e.preventDefault();
        const top = target.getBoundingClientRect().top + window.scrollY - 64;
        window.scrollTo({ top, behavior: "smooth" });
      }
    }
  });
});
