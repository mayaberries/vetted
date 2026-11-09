from fastapi import APIRouter
from app.api.routes.appointments.evaluations import evaluation_router, evaluations_router
from app.api.routes.appointments.feed import router as feed_router
from app.api.scheduling import appts

router = APIRouter()

# Appointments and public booking are served by kalens; the prefixes are ours
# to choose and stay exactly what they were before the extraction.
router.include_router(
    appts.appointments_router, prefix="/services/{service_id}/appointments", tags=["appointments"])
router.include_router(
    evaluation_router,
    prefix="/services/{service_id}/appointments/{appointment_id}/evaluation",
    tags=["evaluations"],
)
router.include_router(
    evaluations_router, prefix="/users/{username}/evaluations", tags=["evaluations"])
router.include_router(feed_router, prefix="/feed", tags=["feed"])
router.include_router(
    appts.public_booking_router, prefix="/public", tags=["public-booking"])