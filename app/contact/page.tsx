import Image from "next/image";
import Link from "next/link";
import "../index.css";
import { FiMail, FiPhone } from "react-icons/fi";

export default function ContactPage() {
    return (
        <main className="page-width contact-page-shell">
            <section className="contact-hero-section">
                <div className="contact-hero-copy">
                    <p className="contact-heading">
                        Get In Touch<span className="story-dot">.</span>
                    </p>
                    <p className="contact-description">
                        Looking to partner or work together? Reach out through the form and I&apos;ll get back to you in the next 48 hours.
                    </p>
                    <div className="contact-info-list">
                        <Link href="mailto:josiahidowutioluwanimi@gmail.com" className="contact-info-item">
                            <span className="contact-info-icon">
                                <FiMail />
                            </span>
                            <span>josiahidowutioluwanimi@gmail.com</span>
                        </Link>
                        <Link href="tel:+2348081274082" className="contact-info-item">
                            <span className="contact-info-icon">
                                <FiPhone />
                            </span>
                            <span>+234 808 127 4082</span>
                        </Link>
                    </div>
                </div>
                <div className="contact-hero-image-wrap">
                    <div className="contact-hero-ring">
                        <div className="contact-hero-image">
                            <Image
                                className="my-image"
                                src="/images/profile.png"
                                alt="Jazz profile"
                                width={420}
                                height={420}
                            />
                        </div>
                    </div>
                </div>
            </section>
        </main>
    );
}
