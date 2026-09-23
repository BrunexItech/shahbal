"""Mombasa County electoral units (IEBC 2012 delimitation): 6 constituencies, 30 wards.
Polling stations are loaded per election cycle via the CSV import endpoint."""

COUNTY = "Mombasa"

CONSTITUENCIES: list[tuple[str, str, list[str]]] = [
    ("001", "Changamwe", ["Port Reitz", "Kipevu", "Airport", "Changamwe", "Chaani"]),
    ("002", "Jomvu", ["Jomvu Kuu", "Miritini", "Mikindani"]),
    ("003", "Kisauni", ["Mjambere", "Junda", "Bamburi", "Mwakirunge", "Mtopanga", "Magogoni", "Shanzu"]),
    ("004", "Nyali", ["Frere Town", "Ziwa La Ng'ombe", "Mkomani", "Kongowea", "Kadzandani"]),
    ("005", "Likoni", ["Mtongwe", "Shika Adabu", "Bofu", "Likoni", "Timbwani"]),
    ("006", "Mvita", ["Mji Wa Kale/Makadara", "Tudor", "Tononoka", "Shimanzi/Ganjoni", "Majengo"]),
]
