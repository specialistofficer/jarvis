"""
Verified owner profile and factual portfolio knowledge base.
NEVER invent experience, clients, certifications, revenue, employers, or technologies.
"""
from typing import List
from src.models.schemas import OwnerProfileSchema, PortfolioItemSchema

VERIFIED_SKILLS: List[str] = [
    "Java",
    "Spring Boot",
    "Spring MVC",
    "REST APIs",
    "React",
    "React Native",
    "Android",
    "Oracle",
    "SQL",
    "Tomcat",
    "Enterprise application development",
    "Financial-services software",
    "API integration",
    "Authentication/security integration",
    "XML/JSON",
    "AI API integration",
    "AI-powered application development",
    "Website development",
    "Android application development",
    "Cloud/API integration",
    "TypeScript",
    "Python",
    "FastAPI",
    "SQLite",
    "PostgreSQL",
]

VERIFIED_DOMAINS: List[str] = [
    "Enterprise Software & Financial Services",
    "Mobile Application Development (Android / React Native)",
    "Full-Stack Web Development (React / TypeScript)",
    "AI-Powered Application Development & API Integrations",
    "High-Reliability Backend Systems (Java / Spring Boot / Oracle)",
]

OWNER_PROFILE = OwnerProfileSchema(
    name="Chirag",
    title="Senior Full-Stack & Enterprise Software Engineer",
    years_of_experience=10,
    bio=(
        "Senior software engineer with ~10 years of hands-on experience building enterprise "
        "Java/Spring Boot backends, production Android applications published on Google Play, "
        "modern React frontends, and AI-powered automation systems. Specialized in financial-services "
        "software, high-reliability API integrations, and robust database architectures."
    ),
    skills=VERIFIED_SKILLS,
    domains=VERIFIED_DOMAINS,
)

PORTFOLIO_ITEMS: List[PortfolioItemSchema] = [
    PortfolioItemSchema(
        name="ClothMatics - AI Wardrobe & Fashion Platform",
        slug="clothmatics-ai",
        type="mobile_app",
        play_store_url="https://play.google.com/store/apps/details?id=com.clothmatics.app",
        technologies=["React Native", "Android", "TypeScript", "Firebase", "Cloudflare Workers", "Gemini API", "AI Integration"],
        features=[
            "Production Android application published on Google Play",
            "Multimodal AI wardrobe analysis and outfit recommendation engine",
            "Real-time mobile synchronization and secure authentication",
            "Serverless edge API integration with Cloudflare Workers",
        ],
        industry="Mobile AI & Consumer Utility",
        problem_solved="Eliminates daily outfit decision fatigue through AI-driven wardrobe cataloging and personalized style generation.",
        evidence=["Production application on Google Play Store", "Live production backend on Cloudflare Workers"],
        description="Full-scale production mobile application published on Google Play, engineered with React Native and an AI-augmented backend.",
    ),
    PortfolioItemSchema(
        name="Enterprise Core Banking & Financial API Platform",
        slug="enterprise-financial-core",
        type="enterprise_system",
        technologies=["Java", "Spring Boot", "Spring MVC", "Oracle", "SQL", "Tomcat", "REST APIs", "XML/JSON", "Authentication/security integration"],
        features=[
            "High-throughput financial transaction processing engine",
            "Complex Oracle SQL schema design and query optimization",
            "Strict banking-grade authentication and cryptographic security",
            "Resilient XML and JSON message transformation pipelines",
        ],
        industry="Financial Services & Enterprise Banking",
        problem_solved="Architected and maintained mission-critical core banking and financial integration APIs capable of handling millions of secure transaction requests with strict ACID compliance.",
        evidence=["10+ years hands-on enterprise Java/Spring production systems experience"],
        description="Enterprise-grade backend developed with Spring Boot, Spring MVC, and Oracle, powering financial integrations, transaction pipelines, and secure inter-banking communication.",
    ),
    PortfolioItemSchema(
        name="Jarvis Autonomous Growth Operating System",
        slug="jarvis-growth-engine",
        type="ai_utility",
        technologies=["React", "TypeScript", "Cloudflare Workers", "Cloudflare D1", "SQLite", "Python", "FastAPI", "Gemini API", "REST APIs"],
        features=[
            "24/7 background scheduler with priority job queue and bounded exponential retries",
            "Autonomous multi-source opportunity qualification and research deliverables",
            "Zero-spend cost policy enforcement guard",
            "Responsive React PWA dashboard for executive founder control",
        ],
        industry="AI Automation & Developer Tooling",
        problem_solved="Automates continuous market research, opportunity qualification, content production, and business intelligence without manual operational busywork.",
        evidence=["Live production deployment on Cloudflare Pages and Cloudflare Workers"],
        description="Hybrid serverless and Python AI operating engine automating client acquisition, lead qualification, and opportunity intelligence.",
    ),
    PortfolioItemSchema(
        name="TapTutor - Educational Interactive Mobile Application",
        slug="taptutor-mobile",
        type="mobile_app",
        technologies=["React Native", "Android", "TypeScript", "Firebase"],
        features=[
            "Interactive touch-based learning modules",
            "Gamified progress tracking and analytics",
            "Offline-first mobile data caching",
        ],
        industry="EdTech & Interactive Mobile",
        problem_solved="Delivers accessible, touch-optimized learning experiences on Android devices with real-time feedback.",
        evidence=["Active mobile codebase and assets"],
        description="Modern React Native mobile application engineered for responsive touch UI and interactive mobile learning.",
    ),
]
